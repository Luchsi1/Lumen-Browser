// IPC surface. Every handler verifies that the sender is one of our own UI pages (never a website).
import { app, clipboard, dialog, ipcMain, Menu, MenuItem, net, session, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { Browser, Win } from './browser.ts'
import type { AppData } from './data.ts'
import type { AdblockService } from './adblock.ts'
import { PasswordVault } from './passwords.ts'
import { exportBookmarksHtml, importTree, parseBookmarksHtml } from './bookmark-html.ts'
import { SEARCH_ENGINES, hostOf, isInternalUrl, normalizeAllowEntry, originOf } from '../shared/url.ts'
import { mergeDefaults } from './store.ts'
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS } from '../shared/defaults.ts'
import type { AppInfo, HistoryEntry, OverlayRequest, PermissionKind, PermissionValue, Settings, SiteInfo, SuggestionItem } from '../shared/types.ts'

export function registerIpc(browser: Browser, data: AppData, adblock: AdblockService, distDir: string) {
  const uiPrefix = pathToFileURL(distDir).toString()

  /** Only our own pages may call privileged APIs. Websites can never reach these channels. */
  function trusted(e: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
    const url = e.senderFrame?.url ?? ''
    if (url.startsWith('lumen://')) return true
    return url.startsWith(uiPrefix)
  }
  function ctx(e: IpcMainInvokeEvent) {
    if (!trusted(e)) throw new Error('Forbidden')
    const w = browser.winForWebContents(e.sender)
    if (!w) throw new Error('No window for sender')
    return w
  }
  const handle = <A extends unknown[], R>(channel: string, fn: (w: Win, e: IpcMainInvokeEvent, ...args: A) => R | Promise<R>) =>
    ipcMain.handle(channel, (e, ...args) => fn(ctx(e), e, ...(args as A)))

  // The real (persistent) profile; private windows read and write bookmarks of their parent profile.
  const persistent = (w: Win) => data.profile(w.parentProfileId)
  const vault = (w: Win) => new PasswordVault(persistent(w))

  // ------------------------------------------------------------------ window and tabs
  handle('win:state', (w) => browser.buildState(w))
  handle('win:info', (w) => ({ windowId: w.id, isPrivate: w.isPrivate, profileId: w.parentProfileId, platform: process.platform }))
  handle('cmd', (w, _e, action: string, arg?: unknown) => browser.exec(w, action, arg))
  handle('nav:go', (w, _e, input: string, opts?: { newTab?: boolean }) => browser.navigate(w, String(input), opts))
  handle('tab:new', (w, _e, url?: string) => { browser.addTab(w, url || browser.newTabUrl(w.profile)) })
  handle('tab:close', (w, _e, id: number) => browser.closeTab(w, id))
  handle('tab:activate', (w, _e, id: number) => browser.activate(w, id))
  handle('tab:move', (w, _e, id: number, index: number, groupId?: string | null) => browser.moveTab(w, id, index, groupId))
  handle('tab:pin', (w, _e, id: number, pinned: boolean) => browser.setPinned(w, id, pinned))
  handle('tab:mute', (w, _e, id: number, muted: boolean) => browser.setMuted(w, id, muted))
  handle('tab:duplicate', (w, _e, id: number) => browser.duplicateTab(w, id))
  handle('tab:allowPopups', (w, _e, id: number) => {
    const t = w.tabs.find((x) => x.id === id)
    const origin = originOf(t?.wc?.getURL() ?? '')
    if (origin) { w.profile.data.setSitePermission(origin, 'popups', 'allow'); if (t) { t.popupBlocked = 0 } browser.sendState(w) }
  })
  handle('group:create', (w, _e, tabIds: number[], name?: string, color?: string) => browser.createGroup(w, tabIds, name, color))
  handle('group:update', (w, _e, id: string, patch: { name?: string; color?: string; collapsed?: boolean }) => browser.updateGroup(w, id, patch))
  handle('group:ungroup', (w, _e, id: string) => browser.ungroup(w, id))
  handle('group:close', (w, _e, id: string) => browser.closeGroup(w, id))
  handle('group:add', (w, _e, tabId: number, groupId: string | null) => browser.addToGroup(w, tabId, groupId))
  handle('sidepanel:toggle', (w, _e, page?: 'bookmarks' | 'history' | 'downloads') => browser.toggleSidePanel(w, page))

  handle('tab:menu', (w, _e, id: number) => {
    const t = w.tabs.find((x) => x.id === id)
    if (!t) return
    const m = new Menu()
    const add = (label: string, click: () => void, enabled = true) => m.append(new MenuItem({ label, click, enabled }))
    const sep = () => m.append(new MenuItem({ type: 'separator' }))
    const idx = w.tabs.indexOf(t)
    add('New tab to the right', () => browser.addTab(w, browser.newTabUrl(w.profile), { afterId: id, groupId: t.groupId }))
    sep()
    add('Reload', () => t.wc?.reload())
    add('Duplicate', () => browser.duplicateTab(w, id))
    add(t.pinned ? 'Unpin' : 'Pin', () => browser.setPinned(w, id, !t.pinned))
    add(t.muted ? 'Unmute site' : 'Mute site', () => browser.setMuted(w, id, !t.muted))
    sep()
    if (!t.pinned) {
      const sub = new Menu()
      sub.append(new MenuItem({ label: 'New group', click: () => browser.createGroup(w, [id]) }))
      for (const g of w.groups) sub.append(new MenuItem({ label: g.name || 'Unnamed group', type: 'checkbox', checked: t.groupId === g.id, click: () => browser.addToGroup(w, id, g.id) }))
      m.append(new MenuItem({ label: 'Add tab to group', submenu: sub }))
      if (t.groupId) add('Remove from group', () => browser.addToGroup(w, id, null))
      sep()
    }
    add('Move tab to new window', () => {
      const url = t.wc?.getURL() || t.url
      void browser.createWindow({ urls: [url], profileId: w.parentProfileId, private: w.isPrivate }).then(() => browser.closeTab(w, id, { record: false }))
    }, w.tabs.length > 1)
    sep()
    add('Close', () => browser.closeTab(w, id))
    add('Close other tabs', () => { for (const o of [...w.tabs]) if (o.id !== id && !o.pinned) browser.closeTab(w, o.id) })
    add('Close tabs to the right', () => { for (const o of w.tabs.slice(idx + 1)) if (!o.pinned) browser.closeTab(w, o.id) }, idx < w.tabs.length - 1)
    add('Reopen closed tab', () => browser.restoreClosedTab(w), w.profile.data.d.closedTabs.length > 0 || w.closedStack.length > 0)
    m.popup({ window: w.win })
  })

  // ------------------------------------------------------------------ overlay
  handle('overlay:show', (w, _e, req: OverlayRequest) => browser.showOverlay(w, req))
  handle('overlay:hide', (w) => browser.hideOverlay(w))
  handle('overlay:current', (w) => w.overlayOpen)
  handle('overlay:result', (w, _e, id: string, value: unknown) => browser.resolvePrompt(w, id, value))

  // ------------------------------------------------------------------ settings
  handle('settings:get', () => data.settings.data)
  handle('settings:set', (_w, _e, patch: Partial<Settings>) => {
    const before = data.settings.data
    const prev = { tracking: before.trackingProtection, theme: before.theme, hw: before.hardwareAcceleration }
    data.settings.data = mergeDefaults(structuredClone(DEFAULT_SETTINGS), deepMerge(structuredClone(before), patch))
    data.settings.save()
    const s = data.settings.data
    if (s.trackingProtection !== prev.tracking) adblock.reconfigure()
    if (s.adblock.autoUpdate !== before.adblock.autoUpdate || s.adblock.updateIntervalHours !== before.adblock.updateIntervalHours) adblock.reconfigure()
    if (patch.shortcuts) browser.rebuildShortcuts()
    browser.broadcastSettings()
    return { restartRequired: s.hardwareAcceleration !== prev.hw }
  })
  handle('settings:setShortcut', (_w, _e, id: string, accel: string | null) => {
    if (!(id in DEFAULT_SHORTCUTS)) throw new Error('Unknown shortcut')
    const sc = data.settings.data.shortcuts
    if (accel === null) delete sc[id]; else sc[id] = String(accel)
    data.settings.save(); browser.rebuildShortcuts(); browser.broadcastSettings()
  })
  handle('settings:reset', () => {
    data.settings.data = structuredClone(DEFAULT_SETTINGS); data.settings.save(); adblock.reconfigure(); browser.rebuildShortcuts(); browser.broadcastSettings()
  })
  handle('settings:chooseDownloadDir', async (w) => {
    const r = await dialog.showOpenDialog(w.win, { properties: ['openDirectory', 'createDirectory'], defaultPath: data.settings.data.downloadDir || app.getPath('downloads') })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('app:info', (): AppInfo => ({
    name: app.getName(), version: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
    v8: process.versions.v8, platform: process.platform, arch: process.arch, userDataPath: app.getPath('userData'),
  }))
  handle('app:setDefaultBrowser', () => {
    app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https')
    if (process.platform === 'win32') void shell.openExternal('ms-settings:defaultapps')
    return { isDefault: app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https') }
  })
  handle('app:isDefaultBrowser', () => app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https'))
  handle('app:relaunch', () => { browser.saveSessionNow(); app.relaunch(); app.exit(0) })
  handle('app:openUserData', () => shell.openPath(app.getPath('userData')))
  handle('app:backupNow', () => { data.settings.backupNow(); data.profile(browser.focusedWin()?.parentProfileId ?? 'default').store.backupNow(); return true })
  handle('app:searchEngines', () => Object.entries(SEARCH_ENGINES).map(([id, e]) => ({ id, name: e.name })))

  // ------------------------------------------------------------------ bookmarks
  handle('bookmarks:list', (w) => { persistent(w).ensureRoots(); return persistent(w).d.bookmarks })
  handle('bookmarks:find', (w, _e, url: string) => persistent(w).findBookmarkByUrl(url) ?? null)
  handle('bookmarks:add', (w, _e, b: { title: string; url?: string; parentId?: string | null; type?: 'bookmark' | 'folder'; favicon?: string }) => {
    const r = persistent(w).addBookmark(b); browser.broadcast('bookmarks:changed'); return r
  })
  handle('bookmarks:update', (w, _e, id: string, patch: { title?: string; url?: string; parentId?: string | null }) => { persistent(w).updateBookmark(id, patch); browser.broadcast('bookmarks:changed') })
  handle('bookmarks:remove', (w, _e, id: string) => { persistent(w).removeBookmark(id); browser.broadcast('bookmarks:changed') })
  handle('bookmarks:move', (w, _e, id: string, parentId: string | null, index: number) => { persistent(w).moveBookmark(id, parentId, index); browser.broadcast('bookmarks:changed') })
  handle('bookmarks:import', async (w) => {
    const r = await dialog.showOpenDialog(w.win, { title: 'Import bookmarks', filters: [{ name: 'Bookmarks HTML', extensions: ['html', 'htm'] }], properties: ['openFile'] })
    if (r.canceled) return null
    const html = fs.readFileSync(r.filePaths[0], 'utf8')
    const tree = parseBookmarksHtml(html)
    if (!tree.length) throw new Error('No bookmarks were found in this file.')
    const p = persistent(w); p.ensureRoots()
    const folder = p.addBookmark({ title: `Imported ${new Date().toLocaleDateString()}`, type: 'folder', parentId: 'other' })
    const { rows, skipped } = importTree(tree, folder.id, randomUUID)
    p.d.bookmarks.push(...rows); p.save(); browser.broadcast('bookmarks:changed')
    return { imported: rows.filter((x) => x.type === 'bookmark').length, skipped }
  })
  handle('bookmarks:export', async (w) => {
    const r = await dialog.showSaveDialog(w.win, { title: 'Export bookmarks', defaultPath: 'bookmarks.html', filters: [{ name: 'Bookmarks HTML', extensions: ['html'] }] })
    if (r.canceled || !r.filePath) return null
    const p = persistent(w); p.ensureRoots()
    fs.writeFileSync(r.filePath, exportBookmarksHtml(p.d.bookmarks))
    return r.filePath
  })

  // ------------------------------------------------------------------ history
  handle('history:query', (w, _e, q: { text?: string; from?: number; to?: number; limit?: number; offset?: number }) => {
    const text = (q.text ?? '').toLowerCase().trim()
    const all = w.profile.data.d.history
    const rows: HistoryEntry[] = []
    for (let i = all.length - 1; i >= 0; i--) {
      const h = all[i]
      if (q.from && h.visitedAt < q.from) continue
      if (q.to && h.visitedAt > q.to) continue
      if (text && !h.title.toLowerCase().includes(text) && !h.url.toLowerCase().includes(text)) continue
      rows.push(h)
    }
    rows.sort((a, b) => b.visitedAt - a.visitedAt)
    const off = q.offset ?? 0
    return { total: rows.length, rows: rows.slice(off, off + (q.limit ?? 200)) }
  })
  handle('history:top', (w, _e, limit: number = 8) => {
    const byHost = new Map<string, HistoryEntry>()
    for (const h of w.profile.data.d.history) {
      if (!/^https?:/.test(h.url)) continue
      const key = hostOf(h.url)
      const cur = byHost.get(key)
      if (!cur || h.visitCount > cur.visitCount) byHost.set(key, { ...h, visitCount: (cur?.visitCount ?? 0) + h.visitCount })
      else cur.visitCount += h.visitCount
    }
    return [...byHost.values()].sort((a, b) => b.visitCount - a.visitCount).slice(0, Math.min(limit, 24))
  })
  handle('history:remove', (w, _e, ids: string[]) => {
    const set = new Set(ids); w.profile.data.d.history = w.profile.data.d.history.filter((h) => !set.has(h.id)); w.profile.data.save(); browser.broadcast('history:changed')
  })
  handle('history:clear', (w, _e, since: number | null) => {
    w.profile.data.d.history = since ? w.profile.data.d.history.filter((h) => h.visitedAt < since) : []
    w.profile.data.save(); browser.broadcast('history:changed')
  })

  // ------------------------------------------------------------------ downloads
  handle('downloads:list', (w) => w.profile.downloads.list())
  handle('downloads:pause', (w, _e, id: string) => w.profile.downloads.pause(id))
  handle('downloads:resume', (w, _e, id: string) => w.profile.downloads.resume(id))
  handle('downloads:cancel', (w, _e, id: string) => w.profile.downloads.cancel(id))
  handle('downloads:open', (w, _e, id: string) => w.profile.downloads.open(id))
  handle('downloads:show', (w, _e, id: string) => w.profile.downloads.showInFolder(id))
  handle('downloads:remove', (w, _e, id: string) => w.profile.downloads.remove(id))
  handle('downloads:clear', (w) => w.profile.downloads.clearFinished())
  handle('downloads:retry', (w, _e, id: string) => {
    const d = w.profile.downloads.list().find((x) => x.id === id)
    if (d) w.active?.wc?.downloadURL(d.url)
  })

  // ------------------------------------------------------------------ omnibox
  handle('omnibox:suggest', async (w, _e, text: string): Promise<SuggestionItem[]> => {
    const q = text.trim().toLowerCase()
    if (!q) return []
    const out: SuggestionItem[] = []
    const seen = new Set<string>()
    const score = (h: HistoryEntry) => {
      const host = hostOf(h.url).replace(/^www\./, '')
      const url = h.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '')
      let s = Math.log2(h.visitCount + 1) + Math.max(0, 5 - (Date.now() - h.visitedAt) / 864e5 / 7)
      if (host.startsWith(q) || url.startsWith(q)) s += 10
      else if (h.title.toLowerCase().startsWith(q)) s += 5
      return s
    }
    if (!w.isPrivate) {
      const hist = w.profile.data.d.history.filter((h) => h.url.toLowerCase().includes(q) || h.title.toLowerCase().includes(q)).sort((a, b) => score(b) - score(a)).slice(0, 5)
      for (const h of persistent(w).d.bookmarks.filter((b) => b.type === 'bookmark' && ((b.url ?? '').toLowerCase().includes(q) || b.title.toLowerCase().includes(q))).slice(0, 3)) {
        if (h.url && !seen.has(h.url)) { seen.add(h.url); out.push({ type: 'bookmark', text: h.title, title: h.title, url: h.url, favicon: h.favicon }) }
      }
      for (const h of hist) if (!seen.has(h.url)) { seen.add(h.url); out.push({ type: 'history', text: h.title, title: h.title, url: h.url, favicon: h.favicon }) }
    }
    if (data.settings.data.searchSuggestions) {
      const eng = SEARCH_ENGINES[data.settings.data.searchEngine]
      if (eng?.suggest) {
        try {
          const res = await net.fetch(eng.suggest.replace('%s', encodeURIComponent(text)), { signal: AbortSignal.timeout(900) })
          const json: any = await res.json()
          const list: unknown[] = Array.isArray(json) && Array.isArray(json[1]) ? json[1] : Array.isArray(json) ? json.map((x: any) => x?.phrase).filter(Boolean) : []
          for (const s of list.slice(0, 5)) if (typeof s === 'string') out.push({ type: 'remote', text: s })
        } catch { /* offline or slow: local suggestions only */ }
      }
    }
    return out.slice(0, 9)
  })

  // ------------------------------------------------------------------ ad blocker
  handle('adblock:status', () => adblock.status())
  handle('adblock:site', (w, _e, tabId: number | null) => {
    const t = w.tabs.find((x) => x.id === tabId)
    return adblock.siteStats(t?.wc?.id ?? null, t?.wc?.getURL() || t?.url || '')
  })
  handle('adblock:setSite', (w, _e, host: string, enabled: boolean) => { adblock.setSiteEnabled(host, enabled); browser.broadcastSettings(); w.active?.wc?.reload() })
  handle('adblock:setGlobal', (_w, _e, enabled: boolean) => { data.settings.data.adblock.enabled = enabled; data.settings.save(); browser.broadcastSettings() })
  handle('adblock:updateAll', async () => { await adblock.updateAll(true); return adblock.status() })
  handle('adblock:updateList', async (_w, _e, id: string) => { await adblock.updateAll(true, id); return adblock.status() })
  handle('adblock:addList', async (_w, _e, name: string, url: string) => { await adblock.addList(name, url); browser.broadcastSettings(); return adblock.status() })
  handle('adblock:removeList', (_w, _e, id: string) => { adblock.removeList(id); browser.broadcastSettings() })
  handle('adblock:toggleList', async (_w, _e, id: string, enabled: boolean) => { await adblock.setListEnabled(id, enabled); browser.broadcastSettings(); return adblock.status() })
  handle('adblock:setCustomRules', (_w, _e, text: string) => { data.settings.data.adblock.customRules = String(text).slice(0, 2_000_000); data.settings.save(); adblock.reconfigure(); browser.broadcastSettings(); return adblock.status() })
  handle('adblock:allowAdd', (_w, _e, entry: string) => { const h = normalizeAllowEntry(entry); if (h) adblock.setSiteEnabled(h, false); browser.broadcastSettings() })
  handle('adblock:allowRemove', (_w, _e, entry: string) => { adblock.setSiteEnabled(entry, true); browser.broadcastSettings() })
  handle('adblock:exportRules', async (w) => {
    const r = await dialog.showSaveDialog(w.win, { defaultPath: 'lumen-custom-rules.txt', filters: [{ name: 'Filter rules', extensions: ['txt'] }] })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, data.settings.data.adblock.customRules); return r.filePath
  })
  handle('adblock:importRules', async (w) => {
    const r = await dialog.showOpenDialog(w.win, { filters: [{ name: 'Filter rules', extensions: ['txt'] }], properties: ['openFile'] })
    if (r.canceled) return null
    const text = fs.readFileSync(r.filePaths[0], 'utf8')
    const cur = data.settings.data.adblock.customRules
    data.settings.data.adblock.customRules = (cur ? cur.replace(/\n*$/, '\n') : '') + text
    data.settings.save(); adblock.reconfigure(); browser.broadcastSettings()
    return data.settings.data.adblock.customRules
  })

  // ------------------------------------------------------------------ extensions
  const exts = (w: Win) => browser.extensionsFor(w.parentProfileId)
  const needExt = (w: Win) => { const m = exts(w); if (!m || w.isPrivate) throw new Error('Extensions are not available in private windows.'); return m }
  handle('extensions:list', (w) => (w.isPrivate ? [] : exts(w)?.list() ?? []))
  handle('extensions:installUnpacked', async (w) => {
    const m = needExt(w)
    const r = await dialog.showOpenDialog(w.win, { title: 'Select the extension folder (contains manifest.json)', properties: ['openDirectory'] })
    if (r.canceled) return null
    return m.installUnpacked(r.filePaths[0])
  })
  handle('extensions:installPackage', async (w) => {
    const m = needExt(w)
    const r = await dialog.showOpenDialog(w.win, { title: 'Select an extension package', filters: [{ name: 'Extension packages', extensions: ['crx', 'zip'] }], properties: ['openFile'] })
    if (r.canceled) return null
    return m.installPackage(r.filePaths[0])
  })
  handle('extensions:setEnabled', (w, _e, id: string, on: boolean) => needExt(w).setEnabled(id, on))
  handle('extensions:reload', (w, _e, id: string) => needExt(w).reload(id))
  handle('extensions:uninstall', async (w, _e, id: string) => {
    const info = needExt(w).list().find((x) => x.id === id)
    const r = await dialog.showMessageBox(w.win, { type: 'warning', buttons: ['Remove', 'Cancel'], defaultId: 1, cancelId: 1, message: `Remove "${info?.name ?? 'this extension'}"?`, detail: 'Its data will be deleted.' })
    if (r.response === 0) await needExt(w).uninstall(id)
  })
  handle('extensions:pin', (w, _e, id: string, pinned: boolean) => needExt(w).setPinned(id, pinned))
  handle('extensions:options', (w, _e, id: string) => needExt(w).openOptions(id))
  handle('extensions:logs', (w, _e, id: string) => needExt(w).getLogs(id))
  handle('extensions:clearLogs', (w, _e, id: string) => needExt(w).clearLogs(id))
  handle('extensions:webstore', (w) => { browser.addTab(w, 'https://chromewebstore.google.com/') })
  handle('extensions:partition', (w) => w.profile.partition)

  // ------------------------------------------------------------------ site info and permissions
  handle('site:info', async (w, _e, tabId: number): Promise<SiteInfo | null> => {
    const t = w.tabs.find((x) => x.id === tabId)
    if (!t) return null
    const url = t.wc?.getURL() || t.url
    const origin = originOf(url)
    const kinds: PermissionKind[] = ['media', 'geolocation', 'notifications', 'popups', 'clipboard-read', 'midi', 'openExternal', 'screen']
    const permissions: SiteInfo['permissions'] = {}
    for (const k of kinds) permissions[k] = w.profile.currentValue(origin, k)
    return { url, origin, host: hostOf(url), security: t.state().security, cookieCount: /^https?:/.test(url) ? await w.profile.cookieCount(url) : 0, permissions }
  })
  handle('site:setPermission', (w, _e, origin: string, kind: PermissionKind, value: PermissionValue | null) => { w.profile.data.setSitePermission(origin, kind, value); browser.broadcast('permissions:changed') })
  handle('site:clearCookies', async (w, _e, url: string) => {
    const cookies = await w.profile.session.cookies.get({ url })
    await Promise.all(cookies.map((c) => w.profile.session.cookies.remove(url, c.name)))
    return cookies.length
  })
  handle('permissions:list', (w) => w.profile.data.d.sitePermissions)
  handle('permissions:reset', (w, _e, origin: string) => { delete w.profile.data.d.sitePermissions[origin]; w.profile.data.save(); browser.broadcast('permissions:changed') })
  handle('cert:proceed', (w, _e, url: string) => { browser.allowCertificate(hostOf(url)); w.active?.navigate(url) })

  // ------------------------------------------------------------------ browsing data
  handle('data:clear', async (w, _e, opts: { since: number | null; history: boolean; downloads: boolean; cookies: boolean; cache: boolean; passwords: boolean; sitePermissions: boolean }) => {
    await w.profile.clearData(opts)
    if (opts.history) browser.broadcast('history:changed')
    browser.broadcast('downloads:changed')
    return true
  })
  handle('data:usage', async (w) => ({ cacheBytes: await w.profile.session.getCacheSize().catch(() => 0), cookieCount: await w.profile.cookieCount() }))
  handle('cookies:sites', async (w) => w.profile.cookieSites())
  handle('cookies:remove', async (w, _e, domain: string) => w.profile.removeCookiesFor(String(domain)))
  handle('cookies:removeAll', async (w) => { await w.profile.session.clearStorageData({ storages: ['cookies'] }); return true })
  handle('data:clearCache', async (w) => { await w.profile.session.clearCache(); return true })

  // ------------------------------------------------------------------ profiles
  handle('profiles:list', () => ({ profiles: data.profiles.data.profiles, lastUsed: data.profiles.data.lastUsed }))
  handle('profiles:add', (_w, _e, name: string, color: string) => data.addProfile(name, color))
  handle('profiles:remove', async (_w, _e, id: string) => { if (id !== 'default') data.removeProfile(id) })
  handle('profiles:open', async (_w, _e, id: string) => { data.profiles.data.lastUsed = id; data.profiles.save(); await browser.createWindow({ profileId: id }) })

  // ------------------------------------------------------------------ passwords
  handle('passwords:available', () => PasswordVault.available())
  handle('passwords:list', (w) => vault(w).list())
  handle('passwords:remove', (w, _e, id: string) => vault(w).remove(id))
  handle('passwords:reveal', async (w, _e, id: string) => {
    const r = await dialog.showMessageBox(w.win, { type: 'question', buttons: ['Show password', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Show this saved password?', detail: 'It will be visible on screen.' })
    return r.response === 0 ? vault(w).reveal(id) : null
  })

  // Messages from web pages (never trusted as UI). They only carry what the user typed into a login form.
  ipcMain.on('pw:submit', async (e, payload: { username: string; password: string }) => {
    try {
      const found = browser.tabForWebContents(e.sender)
      if (!found || found.w.isPrivate || !data.settings.data.offerToSavePasswords || !PasswordVault.available()) return
      const frame = e.senderFrame
      if (!frame || frame.parent) return // top-level frames only
      const origin = originOf(frame.url)
      if (!/^https?:\/\//.test(origin) || typeof payload?.password !== 'string' || !payload.password || payload.password.length > 1024) return
      const username = String(payload.username ?? '').slice(0, 256)
      const v = vault(found.w)
      const existing = v.find(origin, username)
      if (existing && v.lookup(origin).some((x) => x.username === username && x.password === payload.password)) return
      const r = await browser.askPassword(found.w, origin, username, !!existing)
      if (r) v.save(origin, username, payload.password)
    } catch (err) { console.error('[passwords] submit', err) }
  })
  ipcMain.handle('pw:lookup', (e) => {
    const found = browser.tabForWebContents(e.sender)
    const frame = e.senderFrame
    if (!found || found.w.isPrivate || !frame || frame.parent || !PasswordVault.available()) return []
    const origin = originOf(frame.url)
    if (!/^https?:\/\//.test(origin) || isInternalUrl(frame.url)) return []
    return vault(found.w).lookup(origin)
  })

  // ------------------------------------------------------------------ find in page
  handle('find:start', (w, _e, text: string, opts?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) => {
    const wc = w.active?.wc
    if (!wc || !text) { wc?.stopFindInPage('clearSelection'); return }
    wc.findInPage(text, { forward: opts?.forward ?? true, findNext: !!opts?.findNext, matchCase: !!opts?.matchCase })
  })
  handle('find:stop', (w) => { w.active?.wc?.stopFindInPage('clearSelection') })

  // ------------------------------------------------------------------ misc
  handle('page:zoomReset', (w) => w.active?.applyZoom(0))
  handle('window:action', (w, _e, a: 'minimize' | 'maximize' | 'close') => { if (a === 'minimize') w.win.minimize(); else if (a === 'maximize') (w.win.isMaximized() ? w.win.unmaximize() : w.win.maximize()); else w.win.close() })
  handle('win:siteSecurity', (w, _e, tabId: number) => w.tabs.find((t) => t.id === tabId)?.state().security ?? 'internal')
  handle('errorpage:retry', (w, e) => { const f = browser.tabForWebContents(e.sender); if (f) f.tab.navigate(f.tab.url) })
  handle('clipboard:write', (_w, _e, text: string) => { clipboard.writeText(String(text)) })
}

function deepMerge(base: any, patch: any): any {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const out = { ...base }
  for (const k of Object.keys(patch)) out[k] = k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], patch[k]) : patch[k]
  return out
}
