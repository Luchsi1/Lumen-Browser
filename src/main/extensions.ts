// Extension management: install (unpacked / .zip / .crx / Chrome Web Store), enable, disable, reload,
// uninstall, persistence, compatibility analysis and debug logs.
import { app, dialog, webContents as allWebContents, type BrowserWindow, type Session, type WebContents } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore, uninstallExtension as uninstallWebStoreExtension } from 'electron-chrome-web-store'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { analyzeManifest, describeHostAccess, PERMISSION_TEXT } from './extension-compat.ts'
import { unpackExtension } from './crx.ts'
import type { ProfileContext } from './profile.ts'
import type { AppData, ExtensionRecord } from './data.ts'
import type { ExtensionInfo, ExtensionLogEntry } from '../shared/types.ts'

export interface ExtensionHost {
  createTab(details: chrome.tabs.CreateProperties): Promise<[WebContents, BrowserWindow]>
  selectTab(tab: WebContents, win: BrowserWindow): void
  removeTab(tab: WebContents, win: BrowserWindow): void
  createWindow(details: chrome.windows.CreateData): Promise<BrowserWindow>
  removeWindow(win: BrowserWindow): void
  assignTabDetails(details: chrome.tabs.Tab, wc: WebContents): void
  openUrl(profileId: string, url: string): void
}

const MAX_LOGS = 300

export class ExtensionManager extends EventEmitter {
  api: ElectronChromeExtensions
  private logs = new Map<string, ExtensionLogEntry[]>()
  private loadErrors = new Map<string, string>() // keyed by extension path
  private webStoreDir: string
  private packageDir: string

  constructor(private profile: ProfileContext, private app_: AppData, private host: ExtensionHost) {
    super()
    const base = path.join(app_.dir, 'profiles', profile.id)
    this.webStoreDir = path.join(base, 'Extensions')
    this.packageDir = path.join(base, 'ExtensionPackages')
    this.api = new ElectronChromeExtensions({
      session: profile.session,
      createTab: (d: any) => host.createTab(d),
      selectTab: (t: WebContents, w: any) => host.selectTab(t, w as BrowserWindow),
      removeTab: (t: WebContents, w: any) => host.removeTab(t, w as BrowserWindow),
      createWindow: (d: any) => host.createWindow(d),
      removeWindow: (w: any) => host.removeWindow(w as BrowserWindow),
      assignTabDetails: (d: any, wc: WebContents) => host.assignTabDetails(d, wc),
    } as any)
    ElectronChromeExtensions.handleCRXProtocol(profile.session)
    this.watchLogs()
  }

  private get records(): ExtensionRecord[] { return this.profile.data.d.extensions }
  private get exts() { return this.profile.session.extensions }

  async init() {
    try {
      await installChromeWebStore({
        session: this.profile.session,
        extensionsPath: this.webStoreDir,
        loadExtensions: false, // loading is driven by our registry so enable/disable persists
        autoUpdate: true,
        minimumManifestVersion: 3,
        beforeInstall: async (details) => this.confirmWebStoreInstall(details),
      })
    } catch (e) { this.log('browser', 'error', `Chrome Web Store support failed to initialise: ${(e as Error).message}`) }

    // Web Store installs load themselves; register them so they persist and appear in the list.
    this.exts.on('extension-loaded', (_e, ext) => {
      void this.adopt(ext)
    })
    for (const rec of [...this.records]) {
      if (!rec.enabled) continue
      await this.loadRecord(rec)
    }
    // Extensions installed from the Web Store by a previous run that are not registered yet.
    try {
      if (fs.existsSync(this.webStoreDir)) {
        for (const id of fs.readdirSync(this.webStoreDir)) {
          const idDir = path.join(this.webStoreDir, id)
          if (!fs.statSync(idDir).isDirectory() || this.records.some((r) => r.id === id)) continue
          const versions = fs.readdirSync(idDir).sort()
          const latest = versions[versions.length - 1]
          if (latest) {
            const rec: ExtensionRecord = { id, path: path.join(idDir, latest), enabled: true, source: 'webstore', addedAt: Date.now() }
            this.records.push(rec); this.profile.data.save()
            await this.loadRecord(rec)
          }
        }
      }
    } catch (e) { this.log('browser', 'warn', `Scanning Web Store extensions failed: ${(e as Error).message}`) }
    this.emit('changed')
  }

  private async confirmWebStoreInstall(details: { id: string; localizedName: string; manifest: any; browserWindow?: BrowserWindow }) {
    const perms: string[] = (details.manifest.permissions ?? []).map((p: string) => PERMISSION_TEXT[p] ?? p)
    const hosts: string[] = [...(details.manifest.host_permissions ?? []), ...((details.manifest.permissions ?? []).filter((p: string) => /:\/\/|<all_urls>/.test(p)))]
    const report = analyzeManifest({ manifest: details.manifest })
    const lines = [describeHostAccess(hosts), ...perms.filter((p) => !/:\/\//.test(p))]
    const warn = report.issues.filter((i) => i.level !== 'info').map((i) => `- ${i.message}`)
    const opts = {
      type: 'question' as const,
      buttons: ['Add extension', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Add extension',
      message: `Add "${details.localizedName}"?`,
      detail: `It can:\n${lines.map((l) => `- ${l}`).join('\n')}${warn.length ? `\n\nCompatibility in Lumen (${report.level}):\n${warn.join('\n')}` : ''}`,
    }
    const r = details.browserWindow ? await dialog.showMessageBox(details.browserWindow, opts) : await dialog.showMessageBox(opts)
    return { action: r.response === 0 ? ('allow' as const) : ('deny' as const) }
  }

  /** Register an extension that was loaded by the web store installer. */
  private async adopt(ext: Electron.Extension) {
    let rec = this.records.find((r) => r.path === ext.path || r.id === ext.id)
    if (!rec) {
      const source = ext.path.startsWith(this.webStoreDir) ? 'webstore' : 'unpacked'
      rec = { id: ext.id, path: ext.path, enabled: true, source, addedAt: Date.now() }
      this.records.push(rec)
    } else { rec.id = ext.id; rec.path = ext.path }
    this.profile.data.save()
    this.log(ext.id, 'info', `Loaded ${ext.name} ${ext.version}`)
    this.emit('changed')
  }

  private async loadRecord(rec: ExtensionRecord): Promise<Electron.Extension | null> {
    try {
      const ext = await this.exts.loadExtension(rec.path, { allowFileAccess: true })
      rec.id = ext.id
      this.loadErrors.delete(rec.path)
      this.profile.data.save()
      return ext
    } catch (e) {
      const msg = String((e as Error).message ?? e)
      this.loadErrors.set(rec.path, msg)
      this.log(rec.id ?? rec.path, 'error', `Failed to load: ${msg}`)
      return null
    }
  }

  readManifest(dir: string): any {
    const file = path.join(dir, 'manifest.json')
    if (!fs.existsSync(file)) throw new Error('This folder does not contain a manifest.json')
    try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) } catch (e) { throw new Error(`manifest.json is not valid JSON: ${(e as Error).message}`) }
  }

  private collectScripts(dir: string): Record<string, string> {
    const out: Record<string, string> = {}
    let count = 0
    const walk = (d: string, depth: number) => {
      if (depth > 6 || count > 200) return
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '_locales') walk(p, depth + 1) }
        else if (/\.(m?js)$/i.test(e.name) && count < 200) {
          try { if (fs.statSync(p).size < 6 * 1024 * 1024) { out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8'); count++ } } catch { /* unreadable */ }
        }
      }
    }
    try { walk(dir, 0) } catch { /* ignore */ }
    return out
  }

  /** Install from a folder that contains manifest.json. The folder is used in place (not copied). */
  async installUnpacked(dir: string): Promise<ExtensionInfo> {
    return this.installFrom(dir, 'unpacked')
  }

  /** Install from a .zip or .crx file by unpacking it into the profile's package directory. */
  async installPackage(file: string): Promise<ExtensionInfo> {
    const buf = fs.readFileSync(file)
    const hash = createHash('sha1').update(buf).digest('hex').slice(0, 12)
    const dest = path.join(this.packageDir, hash)
    fs.rmSync(dest, { recursive: true, force: true })
    let root: string
    try { root = unpackExtension(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), dest) } catch (e) { fs.rmSync(dest, { recursive: true, force: true }); throw e }
    try { return await this.installFrom(root, 'package') } catch (e) { fs.rmSync(dest, { recursive: true, force: true }); throw e }
  }

  private async installFrom(dir: string, source: ExtensionRecord['source']): Promise<ExtensionInfo> {
    const manifest = this.readManifest(dir)
    const report = analyzeManifest({ manifest, scripts: this.collectScripts(dir) })
    if (report.level === 'unsupported') throw new Error(`Cannot install: ${report.issues.filter((i) => i.level === 'error').map((i) => i.message).join(' ')}`)
    let rec = this.records.find((r) => r.path === dir)
    if (!rec) { rec = { path: dir, enabled: true, source, addedAt: Date.now() }; this.records.push(rec) }
    rec.enabled = true
    const ext = await this.loadRecord(rec)
    if (!ext) {
      const err = this.loadErrors.get(dir) ?? 'unknown error'
      this.records.splice(this.records.indexOf(rec), 1); this.profile.data.save()
      throw new Error(`Chromium refused to load this extension: ${err}`)
    }
    this.log(ext.id, 'info', `Installed from ${dir} (${source}); compatibility: ${report.level}`)
    this.emit('changed')
    return this.info(rec)!
  }

  async setEnabled(id: string, enabled: boolean) {
    const rec = this.records.find((r) => r.id === id)
    if (!rec) return
    rec.enabled = enabled
    if (enabled) await this.loadRecord(rec)
    else if (this.exts.getExtension(id)) this.exts.removeExtension(id)
    this.profile.data.save(); this.emit('changed')
  }

  async reload(id: string) {
    const rec = this.records.find((r) => r.id === id)
    if (!rec) return
    if (this.exts.getExtension(id)) this.exts.removeExtension(id)
    const ext = await this.loadRecord(rec)
    this.log(id, ext ? 'info' : 'error', ext ? 'Reloaded' : 'Reload failed')
    this.emit('changed')
  }

  async uninstall(id: string) {
    const rec = this.records.find((r) => r.id === id)
    if (!rec) return
    if (this.exts.getExtension(id)) this.exts.removeExtension(id)
    if (rec.source === 'webstore') { try { await uninstallWebStoreExtension(id, { session: this.profile.session, extensionsPath: this.webStoreDir }) } catch (e) { this.log(id, 'warn', `Could not delete files: ${(e as Error).message}`) } }
    else if (rec.source === 'package') fs.rmSync(path.dirname(rec.path) === this.packageDir ? rec.path : path.join(this.packageDir, path.basename(rec.path)), { recursive: true, force: true })
    this.profile.data.d.extensions = this.records.filter((r) => r !== rec)
    const pinned = this.app_.settings.data.pinnedExtensions
    this.app_.settings.data.pinnedExtensions = pinned.filter((p) => p !== id)
    this.app_.settings.save(); this.profile.data.save()
    this.logs.delete(id)
    this.emit('changed')
  }

  // ---------------------------------------------------------------- information
  info(rec: ExtensionRecord): ExtensionInfo | null {
    const loaded = rec.id ? this.exts.getExtension(rec.id) : null
    let manifest: any = loaded?.manifest
    if (!manifest) { try { manifest = this.readManifest(rec.path) } catch { manifest = null } }
    if (!manifest) return null
    const scripts = this.collectScripts(rec.path)
    const report = analyzeManifest({ manifest, scripts })
    const perms: string[] = [...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])].filter((p: unknown) => typeof p === 'string')
    const hostPerms: string[] = [...(manifest.host_permissions ?? []), ...perms.filter((p) => /:\/\/|<all_urls>/.test(p))]
    const optionsPage = manifest.options_ui?.page ?? manifest.options_page
    const loadError = this.loadErrors.get(rec.path)
    const issues = [...report.issues]
    if (loadError) issues.unshift({ level: 'error', message: `Failed to load: ${loadError}` })
    if (!rec.enabled) issues.push({ level: 'info', message: 'Disabled.' })
    return {
      id: rec.id ?? createHash('sha1').update(rec.path).digest('hex').slice(0, 32),
      name: manifest.name?.startsWith?.('__MSG_') ? (loaded?.name ?? manifest.name) : manifest.name,
      version: manifest.version, description: manifest.description?.startsWith?.('__MSG_') ? '' : (manifest.description ?? ''),
      enabled: rec.enabled && !!loaded, source: rec.source, path: rec.path, manifestVersion: manifest.manifest_version,
      permissions: perms.filter((p) => !/:\/\/|<all_urls>/.test(p)), hostPermissions: hostPerms,
      optionsUrl: loaded && optionsPage ? `chrome-extension://${rec.id}/${optionsPage}` : undefined,
      hasAction: !!(manifest.action || manifest.browser_action),
      pinned: !!rec.id && this.app_.settings.data.pinnedExtensions.includes(rec.id),
      compat: loadError ? 'unsupported' : report.level, issues, loadError,
      iconUrl: rec.id && loaded ? `crx://extension-icon/${rec.id}/48/2` : undefined,
    }
  }

  list(): ExtensionInfo[] {
    return this.records.map((r) => this.info(r)).filter((x): x is ExtensionInfo => !!x)
  }

  getLogs(id: string): ExtensionLogEntry[] { return this.logs.get(id) ?? [] }
  clearLogs(id: string) { this.logs.delete(id) }

  log(id: string, level: string, message: string, source?: string) {
    const arr = this.logs.get(id) ?? []
    arr.push({ time: Date.now(), level, message, source })
    if (arr.length > MAX_LOGS) arr.splice(0, arr.length - MAX_LOGS)
    this.logs.set(id, arr)
  }

  private extensionIdFromUrl(url: string): string | null {
    const m = /^chrome-extension:\/\/([a-z]{32})\//.exec(url)
    return m ? m[1] : null
  }

  private watchLogs() {
    const levelName = ['verbose', 'info', 'warning', 'error']
    // Background pages and extension pages.
    app.on('web-contents-created', (_e, wc) => {
      if (wc.session !== this.profile.session) return
      wc.on('console-message', (event) => {
        const e: any = event
        const url = String(e.sourceId ?? wc.getURL())
        const id = this.extensionIdFromUrl(url) ?? this.extensionIdFromUrl(wc.getURL())
        if (id) this.log(id, typeof e.level === 'string' ? e.level : levelName[e.level] ?? 'info', String(e.message), `${url.split('/').pop()}:${e.lineNumber ?? ''}`)
      })
      wc.on('render-process-gone', (_ev, d) => {
        const id = this.extensionIdFromUrl(wc.getURL())
        if (id) this.log(id, 'error', `Extension page crashed (${d.reason})`)
      })
    })
    // Manifest V3 service workers.
    try {
      this.profile.session.serviceWorkers.on('console-message', (_e, d: any) => {
        const id = this.extensionIdFromUrl(String(d.sourceUrl ?? ''))
        if (id) this.log(id, String(d.level ?? 'info'), String(d.message), 'service worker')
      })
    } catch { /* older API */ }
  }

  setPinned(id: string, pinned: boolean) {
    const list = this.app_.settings.data.pinnedExtensions
    this.app_.settings.data.pinnedExtensions = pinned ? [...new Set([...list, id])] : list.filter((p) => p !== id)
    this.app_.settings.save(); this.emit('changed')
  }

  openOptions(id: string) {
    const info = this.list().find((e) => e.id === id)
    if (info?.optionsUrl) this.host.openUrl(this.profile.id, info.optionsUrl)
    else throw new Error('This extension has no options page.')
  }

  /** WebContents for all currently running extension pages (for diagnostics). */
  runningPages(): WebContents[] {
    return allWebContents.getAllWebContents().filter((wc) => wc.session === this.profile.session && wc.getURL().startsWith('chrome-extension://'))
  }
}
