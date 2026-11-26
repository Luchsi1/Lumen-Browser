// One browser tab = one Chromium WebContentsView with its own renderer process.
import { WebContentsView, shell, type ContextMenuParams, type Event as ElectronEvent, type Input, type WebContents } from 'electron'
import { isInternalUrl, originOf } from '../shared/url.ts'
import type { TabState } from '../shared/types.ts'
import { applyClientHints, type ProfileContext } from './profile.ts'
import type { AdblockService } from './adblock.ts'

let nextTabId = 1
export const newTabId = () => nextTabId++

export interface TabHost {
  profile: ProfileContext
  adblock: AdblockService
  pagePreload: string
  isPrivate: boolean
  settingsHistoryEnabled(): boolean
  settingsReportAsChrome(): boolean
  getZoom(host: string): number | undefined
  setZoom(host: string, level: number): void
  changed(tab: Tab, urlChanged?: boolean): void
  openTab(url: string, opts: { active: boolean; opener?: Tab }): void
  openPopupWindow(tab: Tab): void
  contextMenu(tab: Tab, params: ContextMenuParams): void
  keyDown(tab: Tab, input: Input, event: ElectronEvent): void
  found(tab: Tab, r: Electron.Result): void
  htmlFullscreen(tab: Tab, on: boolean): void
  confirmExternal(tab: Tab, url: string): Promise<boolean>
  popupAllowed(origin: string): boolean
  registerWithExtensions(tab: Tab): void
}

const WEB_SCHEMES = new Set(['http:', 'https:', 'file:', 'lumen:', 'chrome-extension:', 'blob:', 'data:', 'about:', 'view-source:', 'devtools:', 'ws:', 'wss:', 'filesystem:'])
const SAFE_EXTERNAL = new Set(['mailto:', 'tel:', 'sms:'])
const GESTURE_WINDOW_MS = 1500

export class Tab {
  id = newTabId()
  view: WebContentsView | null = null
  url = ''
  title = ''
  favicon = ''
  loading = false
  audible = false
  muted = false
  pinned = false
  groupId: string | null = null
  discarded = false
  crashed = false
  zoom = 0
  lastActive = Date.now()
  lastInput = 0
  popupBlocked = 0
  error?: { code: number; description: string }
  canGoBack = false
  canGoForward = false
  private recordedUrl = ''

  constructor(public host: TabHost, init: { url: string; title?: string; favicon?: string; pinned?: boolean; groupId?: string | null; discarded?: boolean }) {
    this.url = init.url
    this.title = init.title ?? ''
    this.favicon = init.favicon ?? ''
    this.pinned = !!init.pinned
    this.groupId = init.groupId ?? null
    this.discarded = !!init.discarded
  }

  get wc(): WebContents | null { return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null }

  /** Create the Chromium view. Called immediately for live tabs and lazily when a discarded tab is activated. */
  ensureView(loadUrl?: string): WebContentsView {
    if (this.view && this.wc) return this.view
    const view = new WebContentsView({
      webPreferences: {
        session: this.host.profile.session,
        preload: this.host.pagePreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: true,
        backgroundThrottling: true,
        safeDialogs: true,
        safeDialogsMessage: 'Prevent this page from creating more dialogs',
      },
    })
    this.view = view
    this.discarded = false
    this.crashed = false
    view.setBackgroundColor('#ffffff')
    this.bind(view.webContents)
    this.host.registerWithExtensions(this)
    const target = loadUrl ?? this.url
    // The DevTools command below only completes once the tab has a page, so it must not delay the first navigation.
    if (this.host.settingsReportAsChrome()) void applyClientHints(view.webContents)
    if (target && target !== 'about:blank') this.navigate(target)
    return view
  }

  navigate(url: string) {
    const wc = this.wc
    if (!wc) return
    this.error = undefined
    wc.loadURL(url).catch((e: any) => {
      // ERR_ABORTED (-3) is raised for every navigation that is superseded or turned into a download.
      if (e?.code !== 'ERR_ABORTED' && e?.errno !== -3) console.warn('[tab] loadURL', url, e?.message)
    })
  }

  /** Free the renderer process but keep the tab (used for old background tabs). */
  discard() {
    const wc = this.wc
    if (!wc) return
    this.url = wc.getURL() || this.url
    this.title = wc.getTitle() || this.title
    const view = this.view!
    this.view = null
    this.discarded = true
    this.loading = false
    this.audible = false
    try { view.setVisible(false); view.webContents.close({ waitForBeforeUnload: false }) } catch { /* already gone */ }
  }

  destroy() {
    const wc = this.wc
    this.host.adblock.forgetTab(wc?.id ?? -1)
    this.view = null
    if (wc) { try { wc.close({ waitForBeforeUnload: false }) } catch { /* ignore */ } }
  }

  private bind(wc: WebContents) {
    const host = this.host
    const changed = (urlChanged = false) => host.changed(this, urlChanged)
    const syncNav = () => {
      this.canGoBack = wc.navigationHistory.canGoBack()
      this.canGoForward = wc.navigationHistory.canGoForward()
    }

    wc.setWindowOpenHandler((details) => this.onWindowOpen(details))

    wc.on('page-title-updated', (_e, title) => {
      this.title = title
      if (this.recordedUrl) host.profile.data.updateVisitTitle(this.recordedUrl, title)
      changed()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      if (favicons[0]) { this.favicon = favicons[0]; if (this.recordedUrl) host.profile.data.updateVisitTitle(this.recordedUrl, '', this.favicon); changed() }
    })
    wc.on('did-start-loading', () => { this.loading = true; changed() })
    wc.on('did-stop-loading', () => { this.loading = false; syncNav(); changed() })
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        host.adblock.noteMainNavigation(wc.id, details.url)
        this.popupBlocked = 0
        this.error = undefined
        this.crashed = false
        changed()
      }
    })
    wc.on('did-navigate', (_e, url) => this.onNavigated(wc, url, false))
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) this.onNavigated(wc, url, true) })
    wc.on('did-frame-navigate', () => { changed() })
    wc.on('did-fail-load', (_e, code, desc, validatedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return
      const fallback = host.profile.upgradeFallback(validatedUrl)
      if (fallback) { this.navigate(fallback); return }
      if (isInternalUrl(validatedUrl)) return
      this.error = { code, description: desc }
      this.url = validatedUrl
      const u = `lumen://error/?code=${code}&desc=${encodeURIComponent(desc)}&url=${encodeURIComponent(validatedUrl)}`
      wc.loadURL(u).catch(() => {})
      changed(true)
    })
    wc.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
      if (isMainFrame && /^lumen:/i.test(url) && !isInternalUrl(wc.getURL())) { event.preventDefault(); return }
      if (!isMainFrame) return
      const r = host.adblock.shouldBlockNavigation(url, wc.getURL())
      if (r.blocked) { event.preventDefault(); host.adblock.notePopupBlocked(wc.id, url, r.rule ?? 'redirect'); changed() }
    })
    wc.on('will-navigate', (event, url) => {
      let proto = ''
      try { proto = new URL(url).protocol } catch { /* ignore */ }
      // Renderer-initiated navigation from a website into an internal page is refused: those pages carry the privileged API.
      if (proto === 'lumen:' && !isInternalUrl(wc.getURL())) { event.preventDefault(); return }
      if (proto && !WEB_SCHEMES.has(proto)) {
        event.preventDefault()
        void this.openExternal(url, proto)
      }
    })
    wc.on('audio-state-changed', (e: any) => { this.audible = !!e.audible; changed() })
    wc.on('render-process-gone', (_e, d) => {
      if (d.reason === 'clean-exit') return
      this.crashed = true; this.loading = false; changed()
    })
    wc.on('unresponsive', () => { /* Chromium shows its own hang UI in the page area */ })
    wc.on('context-menu', (_e, params) => host.contextMenu(this, params))
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' || input.type === 'mouseDown') this.lastInput = Date.now()
      if (input.type === 'keyDown') host.keyDown(this, input, event)
    })
    wc.on('input-event' as any, (_e: any, ev: any) => { if (ev?.type === 'mouseDown') this.lastInput = Date.now() })
    wc.on('found-in-page', (_e, r) => host.found(this, r))
    wc.on('enter-html-full-screen', () => host.htmlFullscreen(this, true))
    wc.on('leave-html-full-screen', () => host.htmlFullscreen(this, false))
    wc.on('zoom-changed' as any, (_e: any, dir: 'in' | 'out') => {
      const next = Math.max(-3, Math.min(5, wc.getZoomLevel() + (dir === 'in' ? 0.5 : -0.5)))
      this.applyZoom(next)
    })
    wc.on('destroyed', () => { host.adblock.forgetTab(wc.id) })
  }

  private onNavigated(wc: WebContents, url: string, inPage: boolean) {
    this.url = url
    syncUrlState(this, wc)
    const host = this.host
    if (!inPage) {
      const h = safeHost(url)
      const z = host.getZoom(h)
      if (z !== undefined && z !== wc.getZoomLevel()) wc.setZoomLevel(z)
      this.zoom = wc.getZoomLevel()
    }
    // History: real http(s) pages only, never in private mode, never when disabled.
    if (!host.isPrivate && host.settingsHistoryEnabled() && /^https?:/i.test(url) && !this.error) {
      if (url !== this.recordedUrl || !inPage) host.profile.data.addVisit(url, wc.getTitle(), this.favicon || undefined)
      this.recordedUrl = url
    }
    host.changed(this, true)
  }

  applyZoom(level: number) {
    const wc = this.wc
    if (!wc) return
    wc.setZoomLevel(level)
    this.zoom = level
    this.host.setZoom(safeHost(wc.getURL()), level)
    this.host.changed(this)
  }

  private async openExternal(url: string, proto: string) {
    if (!SAFE_EXTERNAL.has(proto) && !(await this.host.confirmExternal(this, url))) return
    if (/^(file|javascript|vbscript|data):/i.test(url)) return
    shell.openExternal(url).catch(() => {})
  }

  private onWindowOpen(details: Electron.HandlerDetails): Electron.WindowOpenHandlerResponse {
    const host = this.host
    const url = details.url
    const from = this.wc?.getURL() ?? ''
    const fromOrigin = originOf(from)
    let proto = ''
    try { proto = new URL(url).protocol } catch { /* about:blank etc. */ }
    if (proto === 'lumen:' && !isInternalUrl(from)) return { action: 'deny' }
    if (proto && !WEB_SCHEMES.has(proto)) { void this.openExternal(url, proto); return { action: 'deny' } }

    const recentGesture = Date.now() - this.lastInput < GESTURE_WINDOW_MS
    const siteAllows = host.popupAllowed(fromOrigin)
    const rule = host.adblock.shouldBlockPopup(url, from)
    if (rule.blocked && !siteAllows) {
      if (this.wc) host.adblock.notePopupBlocked(this.wc.id, url, rule.rule ?? 'popup rule')
      this.popupBlocked++; host.changed(this); return { action: 'deny' }
    }
    if (!recentGesture && !siteAllows && details.disposition !== 'other') {
      // Script opened a window without any user input shortly before: a pop-up.
      if (this.wc) host.adblock.notePopupBlocked(this.wc.id, url, 'no user gesture')
      this.popupBlocked++; host.changed(this); return { action: 'deny' }
    }

    // Windows opened with explicit features (OAuth / payment pop-ups) stay real windows so window.opener keeps working.
    if (details.disposition === 'new-window' && details.features) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: host.pagePreload },
        },
      }
    }
    host.openTab(url, { active: details.disposition !== 'background-tab', opener: this })
    return { action: 'deny' }
  }

  state(): TabState {
    const wc = this.wc
    let security: TabState['security'] = 'secure'
    const url = this.error ? this.url : (wc?.getURL() || this.url)
    if (this.error) security = 'error'
    else if (/^https:/i.test(url)) security = 'secure'
    else if (/^http:/i.test(url)) security = 'insecure'
    else if (/^file:/i.test(url)) security = 'file'
    else if (isInternalUrl(url) || /^chrome-extension:/i.test(url) || url === '' || url === 'about:blank') security = 'internal'
    else security = 'insecure'
    return {
      id: this.id, wcId: wc?.id ?? 0, url, title: this.title || (isInternalUrl(url) ? '' : url), favicon: this.favicon, loading: this.loading,
      canGoBack: this.canGoBack, canGoForward: this.canGoForward, audible: this.audible, muted: this.muted, pinned: this.pinned, groupId: this.groupId,
      security, discarded: this.discarded, crashed: this.crashed, blockedCount: wc ? this.host.adblock.blockedCount(wc.id) : 0, popupBlocked: this.popupBlocked,
      zoom: this.zoom, error: this.error,
    }
  }
}

function syncUrlState(tab: Tab, wc: WebContents) {
  tab.canGoBack = wc.navigationHistory.canGoBack()
  tab.canGoForward = wc.navigationHistory.canGoForward()
}

function safeHost(url: string) { try { return new URL(url).hostname } catch { return '' } }
