// A ProfileContext owns one Electron Session (persistent or in-memory) and wires all browser
// behaviour into it: protocol handler, request filtering, cookies, permissions, downloads.
import os from 'node:os'
import { app, BrowserWindow, desktopCapturer, webContents, session as electronSession, net, type Session, type WebContents } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import { parse as parseUrl } from 'tldts-experimental'
import { DownloadManager } from './downloads.ts'
import { ProfileData, type AppData } from './data.ts'
import type { AdblockService } from './adblock.ts'
import { isLocalOrPrivateHost, originOf } from '../shared/url.ts'
import type { PermissionKind, PermissionValue } from '../shared/types.ts'

export type PromptFn = (wc: WebContents | null, kind: PermissionKind, origin: string, label: string) => Promise<{ allow: boolean; remember: boolean }>
export type ScreenPromptFn = (wc: WebContents | null, origin: string, sources: { id: string; name: string; thumbnail: string }[]) => Promise<string | null>

const PERMISSION_MAP: Record<string, PermissionKind | 'allow' | 'deny'> = {
  media: 'media', geolocation: 'geolocation', notifications: 'notifications', 'clipboard-read': 'clipboard-read', fullscreen: 'fullscreen',
  midi: 'midi', midiSysex: 'midi', openExternal: 'openExternal', 'display-capture': 'screen',
  // Everything below is needed by ordinary modern sites and carries no meaningful prompt in Chrome either.
  'clipboard-sanitized-write': 'allow', pointerLock: 'allow', keyboardLock: 'allow', 'speaker-selection': 'allow', 'idle-detection': 'deny',
  'window-management': 'deny', 'top-level-storage-access': 'allow', 'storage-access': 'allow', 'background-sync': 'allow', 'accessibility-events': 'allow',
  unknown: 'deny',
}

const LABELS: Record<PermissionKind, string> = {
  media: 'use your camera and/or microphone', geolocation: 'know your location', notifications: 'show notifications', popups: 'open pop-up windows',
  'clipboard-read': 'see text and images copied to the clipboard', fullscreen: 'go fullscreen', midi: 'use your MIDI devices', openExternal: 'open an external application', screen: 'share your screen',
}

export function chromeUserAgent(): string {
  const major = process.versions.chrome.split('.')[0]
  const os = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}


/** Low-entropy client hint headers, the way Chrome sends them on every request to a secure origin. */
function lowEntropyHints(): Record<string, string> {
  const major = process.versions.chrome.split('.')[0]
  const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'
  return {
    'sec-ch-ua': `"Not.A/Brand";v="8", "Chromium";v="${major}", "Google Chrome";v="${major}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': `"${platform}"`,
  }
}

/** High-entropy hints, only sent after the origin asked for them with an Accept-CH response header. */
function highEntropyHint(name: string): string | null {
  const full = process.versions.chrome
  switch (name) {
    case 'sec-ch-ua-full-version-list': return `"Not.A/Brand";v="8.0.0.0", "Chromium";v="${full}", "Google Chrome";v="${full}"`
    case 'sec-ch-ua-full-version': return `"${full}"`
    case 'sec-ch-ua-arch': return process.arch === 'arm64' ? '"arm"' : '"x86"'
    case 'sec-ch-ua-bitness': return '"64"'
    case 'sec-ch-ua-model': return '""'
    case 'sec-ch-ua-wow64': return '?0'
    case 'sec-ch-ua-platform-version': {
      const build = Number(os.release().split('.')[2] ?? 0)
      return process.platform === 'win32' ? (build >= 22000 ? '"15.0.0"' : '"10.0.0"') : process.platform === 'darwin' ? '"14.0.0"' : '"6.0.0"'
    }
    default: return null
  }
}

/**
 * Chromium sends client hints (Sec-CH-UA, navigator.userAgentData) with brands "Chromium" and a GREASE entry only when it is
 * embedded by Electron. Together with a "Chrome/..." user agent this looks like an embedded app and Google refuses sign-in.
 * Chrome-compatible browsers (Edge, Brave, Opera) report their own brand plus Chromium. Lumen reports Chrome's brand set, matching
 * its Chrome user agent, so both agree. Uses the DevTools protocol, which is the only way to change navigator.userAgentData.
 */
export async function applyClientHints(wc: WebContents): Promise<void> {
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    const full = process.versions.chrome
    const major = full.split('.')[0]
    const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'
    const build = Number(os.release().split('.')[2] ?? 0)
    const platformVersion = process.platform === 'win32' ? (build >= 22000 ? '15.0.0' : '10.0.0') : process.platform === 'darwin' ? '14.0.0' : '6.0.0'
    const t0 = Date.now()
    await wc.debugger.sendCommand('Emulation.setUserAgentOverride', {
      userAgent: chromeUserAgent(),
      userAgentMetadata: {
        brands: [{ brand: 'Not.A/Brand', version: '8' }, { brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }],
        fullVersionList: [{ brand: 'Not.A/Brand', version: '8.0.0.0' }, { brand: 'Chromium', version: full }, { brand: 'Google Chrome', version: full }],
        platform, platformVersion, architecture: process.arch === 'arm64' ? 'arm' : 'x86', model: '', mobile: false, bitness: '64', wow64: false,
      },
    })
    if (process.env.LUMEN_DEBUG_HINTS) console.log('[hints] applied in', Date.now() - t0, 'ms')
  } catch (e) { console.warn('[hints] could not apply client hints', e) }
}

export class ProfileContext {
  session: Session
  data: ProfileData
  downloads: DownloadManager
  readonly isPrivate: boolean
  readonly partition: string
  // Hosts for which an automatic https upgrade failed. They stay on http for the rest of the run.
  private noUpgrade = new Set<string>()
  // https url -> original http url, so a failed upgrade can fall back
  upgraded = new Map<string, string>()
  // origin -> client hints it asked for via Accept-CH (kept for the run, like Chrome's per-session hint cache)
  private hintRequests = new Map<string, Set<string>>()
  prompt: PromptFn | null = null
  screenPrompt: ScreenPromptFn | null = null
  windowFor: (wc: WebContents | null) => BrowserWindow | null = () => null

  constructor(public id: string, privateIndex: number | null, private app_: AppData, private adblock: AdblockService, private appDist: string) {
    this.isPrivate = privateIndex !== null
    if (this.isPrivate) {
      this.partition = `lumen-private-${privateIndex}` // no "persist:" prefix = in-memory session
      this.data = new ProfileData('', true)
    } else {
      this.partition = `persist:profile-${id}`
      this.data = app_.profile(id)
    }
    this.session = electronSession.fromPartition(this.partition)
    this.downloads = new DownloadManager(
      this.data,
      () => this.app_.settings.data.downloadDir || app.getPath('downloads'),
      () => this.app_.settings.data.askDownloadLocation,
      this.isPrivate,
      (wc) => this.windowFor(wc),
    )
    this.setup()
  }

  private get settings() { return this.app_.settings.data }

  private setup() {
    const ses = this.session
    ses.setUserAgent(chromeUserAgent())
    ses.setSpellCheckerEnabled(true)
    this.registerLumenProtocol(ses)
    this.adblock.registerSession(ses)
    this.downloads.attach(ses)
    this.installWebRequestHooks(ses)
    this.installPermissions(ses)
  }

  // ---------------------------------------------------------------- lumen:// pages
  private registerLumenProtocol(ses: Session) {
    const root = path.join(this.appDist, 'renderer')
    ses.protocol.handle('lumen', (req) => {
      const u = new URL(req.url)
      if (u.pathname.startsWith('/assets/')) {
        const assets = path.join(root, 'assets')
        const file = path.normalize(path.join(root, u.pathname))
        if (!file.startsWith(assets + path.sep)) return new Response('Forbidden', { status: 403 })
        return net.fetch(pathToFileURL(file).toString())
      }
      if (u.host === 'resource') {
        const stub = this.adblock.getStub(u.pathname.replace(/^\//, ''))
        if (!stub) return new Response('Not found', { status: 404 })
        return new Response(new Uint8Array(stub.body), { headers: { 'content-type': stub.mime, 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin', 'cache-control': 'max-age=3600' } })
      }
      // Every lumen://<page>/ is served by the single internal-pages app, which routes on the host name.
      return net.fetch(pathToFileURL(path.join(root, 'pages.html')).toString())
    })
  }

  // ---------------------------------------------------------------- web request pipeline
  private topSite(wc: WebContents | undefined, fallback: string): string {
    return wc && !wc.isDestroyed() ? wc.getURL() : fallback
  }

  private installWebRequestHooks(ses: Session) {
    const wr = ses.webRequest

    wr.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
      try {
        const url = details.url
        // Automatic HTTPS upgrade for top-level http navigations.
        if (details.resourceType === 'mainFrame' && url.startsWith('http://') && this.settings.httpsUpgrade) {
          const u = new URL(url)
          if (!isLocalOrPrivateHost(u.hostname) && !this.noUpgrade.has(u.hostname) && u.port === '') {
            u.protocol = 'https:'
            this.upgraded.set(u.toString(), url)
            if (this.upgraded.size > 200) this.upgraded.delete(this.upgraded.keys().next().value!)
            return cb({ redirectURL: u.toString() })
          }
        }
        const r = this.adblock.handleRequest(details)
        if (r) return cb(r)
      } catch (e) { console.error('[webRequest] onBeforeRequest', e) }
      cb({})
    })

    wr.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, cb) => {
      const headers = details.requestHeaders
      try {
        if (this.settings.reportAsChrome && /^(https:|http:\/\/(localhost|127\.0\.0\.1|\[::1\]))/i.test(details.url)) {
          // session.setUserAgent() makes Chromium drop its own client hints. Chrome always sends these, so add them back.
          for (const [k, v] of Object.entries(lowEntropyHints())) headers[k] = v
          const asked = this.hintRequests.get(originOf(details.url))
          if (asked) for (const name of asked) { const v = highEntropyHint(name); if (v) headers[name] = v }
        }
        if (this.settings.trackingProtection) headers['Sec-GPC'] = '1'
        if (this.settings.sendDoNotTrack) headers['DNT'] = '1'
        if (this.settings.blockThirdPartyCookies && details.resourceType !== 'mainFrame') {
          const top = this.topSite(details.webContents, details.referrer)
          if (top && /^https?:/i.test(top) && isThirdParty(details.url, top)) {
            for (const k of Object.keys(headers)) if (k.toLowerCase() === 'cookie') delete headers[k]
          }
        }
      } catch { /* never break a request because of header handling */ }
      cb({ requestHeaders: headers })
    })

    wr.onHeadersReceived({ urls: ['<all_urls>'] }, (details, cb) => {
      try {
        const responseHeaders = details.responseHeaders ?? {}
        let changed = false
        if (this.settings.reportAsChrome) {
          for (const k of Object.keys(responseHeaders)) {
            if (k.toLowerCase() !== 'accept-ch') continue
            const origin = originOf(details.url)
            const set = this.hintRequests.get(origin) ?? new Set<string>()
            for (const v of responseHeaders[k]) for (const n of v.split(',')) { const name = n.trim().toLowerCase(); if (name.startsWith('sec-ch-ua')) set.add(name) }
            this.hintRequests.set(origin, set)
            if (this.hintRequests.size > 500) this.hintRequests.delete(this.hintRequests.keys().next().value!)
          }
        }
        if (this.settings.blockThirdPartyCookies && details.resourceType !== 'mainFrame') {
          const top = this.topSite(details.webContents, details.referrer)
          if (top && /^https?:/i.test(top) && isThirdParty(details.url, top)) {
            for (const k of Object.keys(responseHeaders)) if (k.toLowerCase() === 'set-cookie') { delete responseHeaders[k]; changed = true }
          }
        }
        const csp = this.adblock.cspFor(details)
        if (csp) {
          const policies = csp.split(';').map((s) => s.trim()).filter(Boolean)
          for (const k of Object.keys(responseHeaders)) if (k.toLowerCase() === 'content-security-policy') { policies.push(...responseHeaders[k]); delete responseHeaders[k] }
          responseHeaders['content-security-policy'] = [policies.join(';')]
          changed = true
        }
        if (changed) return cb({ responseHeaders })
      } catch (e) { console.error('[webRequest] onHeadersReceived', e) }
      cb({})
    })
  }

  /** Called by a tab when a main-frame navigation fails. Returns the http URL to fall back to, if the failed URL was an automatic upgrade. */
  upgradeFallback(failedUrl: string): string | null {
    const original = this.upgraded.get(failedUrl)
    if (!original) return null
    this.upgraded.delete(failedUrl)
    try { this.noUpgrade.add(new URL(original).hostname) } catch { /* ignore */ }
    return original
  }

  // ---------------------------------------------------------------- permissions
  kindFor(permission: string, details?: any): PermissionKind | 'allow' | 'deny' {
    const k = PERMISSION_MAP[permission]
    if (k === undefined) return 'deny'
    return k
  }

  currentValue(origin: string, kind: PermissionKind): PermissionValue {
    return this.data.getSitePermission(origin, kind) ?? this.settings.permissionDefaults[kind] ?? 'ask'
  }

  private installPermissions(ses: Session) {
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      const kind = this.kindFor(permission, details)
      if (kind === 'allow') return true
      if (kind === 'deny') return false
      // Checks are synchronous: only an explicit allow counts, "ask" is treated as not granted yet.
      const origin = originOf(requestingOrigin) || requestingOrigin
      if (origin.startsWith('lumen://') || origin.startsWith('file://')) return kind !== 'screen'
      return this.currentValue(origin, kind) === 'allow'
    })

    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const kind = this.kindFor(permission, details)
      if (kind === 'allow') return callback(true)
      if (kind === 'deny') return callback(false)
      const origin = originOf((details as any).requestingUrl || wc?.getURL() || '')
      if (origin.startsWith('lumen://')) return callback(kind !== 'screen')
      const cur = this.currentValue(origin, kind)
      if (cur === 'allow') return callback(true)
      if (cur === 'block') return callback(false)
      if (!this.prompt) return callback(false)
      let label = LABELS[kind]
      if (kind === 'media') {
        const types: string[] = (details as any).mediaTypes ?? []
        label = types.includes('video') && types.includes('audio') ? 'use your camera and microphone' : types.includes('video') ? 'use your camera' : 'use your microphone'
      }
      this.prompt(wc ?? null, kind, origin, label).then((r) => {
        if (r.remember) this.data.setSitePermission(origin, kind, r.allow ? 'allow' : 'block')
        callback(r.allow)
      }).catch(() => callback(false))
    })

    ses.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const wc = request.frame ? webContents.fromFrame(request.frame) : null
        const origin = originOf(request.frame?.url ?? '')
        if (this.currentValue(origin, 'screen') === 'block' || !this.screenPrompt) return callback({})
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } })
        const picked = await this.screenPrompt(wc ?? null, origin, sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() })))
        const src = sources.find((s) => s.id === picked)
        if (!src) return callback({})
        callback({ video: src, audio: request.audioRequested ? 'loopback' : undefined } as any)
      } catch (e) { console.error('[display-media]', e); callback({}) }
    }, { useSystemPicker: false })
  }

  // ---------------------------------------------------------------- cookies and data
  async cookieCount(url?: string): Promise<number> {
    try { return (await this.session.cookies.get(url ? { url } : {})).length } catch { return 0 }
  }

  /** Cookies grouped by site (registrable-looking domain, leading dot removed). */
  async cookieSites(): Promise<{ domain: string; count: number; names: string[] }[]> {
    const all = await this.session.cookies.get({}).catch(() => [])
    const m = new Map<string, string[]>()
    for (const c of all) { const d = (c.domain ?? '').replace(/^\./, ''); if (d) (m.get(d) ?? m.set(d, []).get(d)!).push(c.name) }
    return [...m.entries()].map(([domain, names]) => ({ domain, count: names.length, names: names.slice(0, 50) })).sort((a, b) => a.domain.localeCompare(b.domain))
  }

  /** Removes every cookie set by a domain or its subdomains. Returns how many were removed. */
  async removeCookiesFor(domain: string): Promise<number> {
    const d = domain.replace(/^\./, '').toLowerCase()
    const all = await this.session.cookies.get({}).catch(() => [])
    let n = 0
    for (const c of all) {
      const cd = (c.domain ?? '').replace(/^\./, '').toLowerCase()
      if (cd !== d && !cd.endsWith('.' + d)) continue
      const url = `http${c.secure ? 's' : ''}://${cd}${c.path ?? '/'}`
      try { await this.session.cookies.remove(url, c.name); n++ } catch { /* already gone */ }
    }
    return n
  }

  async clearData(opts: { since: number | null; history: boolean; downloads: boolean; cookies: boolean; cache: boolean; passwords: boolean; sitePermissions: boolean; formData?: boolean }) {
    const since = opts.since
    if (opts.cookies) {
      // Electron cannot scope cookies or site storage by time (no creation time is exposed), so this is always "all time".
      await this.session.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache'] })
    }
    if (opts.cache) { await this.session.clearCache(); await this.session.clearCodeCaches({}) }
    if (opts.history) this.data.d.history = since ? this.data.d.history.filter((h) => h.visitedAt < since) : []
    if (opts.downloads) this.data.d.downloads = this.data.d.downloads.filter((d) => (d.status === 'progressing' || d.status === 'paused') || (since ? (d.endedAt ?? d.startedAt) < since : false))
    if (opts.passwords) this.data.d.passwords = since ? this.data.d.passwords.filter((p) => p.createdAt < since) : []
    if (opts.sitePermissions) this.data.d.sitePermissions = {}
    this.data.save()
  }

  /** Destroy a private session's data. */
  async destroyPrivate() {
    if (!this.isPrivate) return
    try { await this.session.clearStorageData(); await this.session.clearCache(); await this.session.clearAuthCache(); await this.session.clearHostResolverCache() } catch { /* session may already be gone */ }
  }
}

function isThirdParty(url: string, top: string): boolean {
  const a = parseUrl(url), b = parseUrl(top)
  if (!a.domain || !b.domain) return a.hostname !== b.hostname
  return a.domain !== b.domain
}

export function ensureExists(p: string) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }) }
