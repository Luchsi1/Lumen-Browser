// The browser itself: windows, tab strip model, groups, session restore, overlays, shortcuts, context menus.
import { app, BrowserWindow, Menu, MenuItem, WebContentsView, clipboard, dialog, ipcMain, nativeTheme, shell, type ContextMenuParams, type Input, type WebContents } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Tab, type TabHost } from './tab.ts'
import { ProfileContext } from './profile.ts'
import { ExtensionManager, type ExtensionHost } from './extensions.ts'
import type { AppData, SavedWindow } from './data.ts'
import type { AdblockService } from './adblock.ts'
import { DEFAULT_SHORTCUTS } from '../shared/defaults.ts'
import { matches, parseAccelerator, type Accel } from '../shared/shortcuts.ts'
import { SEARCH_ENGINES, resolveInput, searchUrl, originOf, hostOf } from '../shared/url.ts'
import type { OverlayRequest, PermissionKind, PromptRequest, TabGroup, WindowState } from '../shared/types.ts'

export const TAB_H = 40
export const TOOLBAR_H = 44
export const BOOKMARKS_H = 32
export const SIDE_PANEL_W = 340
export const GROUP_COLORS = ['#8ab4f8', '#f28b82', '#fdd663', '#81c995', '#ff8bcb', '#78d9ec', '#c58af9', '#fcad70']

export interface Paths { dist: string; chromePreload: string; pagePreload: string; chromeHtml: string; overlayHtml: string; icon: string }

export class Win {
  tabs: Tab[] = []
  groups: TabGroup[] = []
  activeId: number | null = null
  overlay!: WebContentsView
  sidePanel: WebContentsView | null = null
  overlayOpen: OverlayRequest | null = null
  fullscreen = false
  htmlFullscreenTab: Tab | null = null
  closedStack: { url: string; title: string; pinned: boolean; groupId: string | null }[] = []
  prompts: { req: PromptRequest; resolve: (v: any) => void }[] = []
  currentPrompt: { req: PromptRequest; resolve: (v: any) => void } | null = null
  stateTimer: NodeJS.Timeout | null = null
  constructor(public win: BrowserWindow, public profile: ProfileContext, public parentProfileId: string) {}
  get id() { return this.win.id }
  get isPrivate() { return this.profile.isPrivate }
  get active(): Tab | null { return this.tabs.find((t) => t.id === this.activeId) ?? null }
  get chrome(): WebContents { return this.win.webContents }
}

export class Browser {
  windows = new Map<number, Win>()
  private profiles = new Map<string, ProfileContext>()
  private extensions = new Map<string, ExtensionManager>()
  private extReady = new Map<string, Promise<void>>()
  private privateCounter = 0
  private uiSession!: Electron.Session
  private sessionFrozen = false
  private sessionTimer: NodeJS.Timeout | null = null
  private accels: { id: string; acc: Accel }[] = []
  private lastFocused: Win | null = null
  private certExceptions = new Set<string>()
  quitting = false
  adblock: AdblockService
  private extHost: ExtensionHost

  constructor(public data: AppData, adblock: AdblockService, public paths: Paths, uiSession: Electron.Session) {
    this.adblock = adblock
    this.uiSession = uiSession
    this.extHost = this.makeExtensionHost()
    this.rebuildShortcuts()
    setInterval(() => this.discardIdleTabs(), 60_000).unref()
  }

  get settings() { return this.data.settings.data }

  // ------------------------------------------------------------------ profiles
  getProfile(id: string): ProfileContext {
    let p = this.profiles.get(id)
    if (!p) {
      p = new ProfileContext(id, null, this.data, this.adblock, this.paths.dist)
      this.wireProfile(p)
      this.profiles.set(id, p)
      const ext = new ExtensionManager(p, this.data, this.extHost)
      this.extensions.set(id, ext)
      this.extReady.set(id, ext.init().catch((e) => console.error('[extensions] init', e)))
      ext.on('changed', () => this.broadcast('extensions:changed'))
    }
    return p
  }

  private wireProfile(p: ProfileContext) {
    p.prompt = (wc, kind, origin, label) => this.askPermission(wc, kind, origin, label)
    p.screenPrompt = (wc, origin, sources) => this.askScreen(wc, origin, sources)
    p.windowFor = (wc) => (wc ? this.winForWebContents(wc)?.win ?? null : null)
    p.downloads.on('changed', () => this.broadcast('downloads:changed'))
    p.downloads.on('started', () => { for (const w of this.windows.values()) if (w.profile.id === p.id || w.profile === p) this.post(w, 'downloads:started') })
  }

  extensionsFor(profileId: string): ExtensionManager | undefined { return this.extensions.get(profileId) }

  /** All profile contexts, including private ones that are still open. */
  allProfiles(): ProfileContext[] { return [...this.profiles.values()] }

  // ------------------------------------------------------------------ windows
  async createWindow(opts: { profileId?: string; private?: boolean; urls?: string[]; restore?: SavedWindow; bounds?: Electron.Rectangle } = {}): Promise<Win> {
    const isPrivate = !!opts.private
    const parentId = opts.profileId ?? this.data.profiles.data.lastUsed ?? 'default'
    let profile: ProfileContext
    if (isPrivate) {
      profile = new ProfileContext(`private-${++this.privateCounter}`, this.privateCounter, this.data, this.adblock, this.paths.dist)
      this.wireProfile(profile)
    } else {
      profile = this.getProfile(parentId)
      await Promise.race([this.extReady.get(parentId), new Promise((r) => setTimeout(r, 6000))])
    }
    this.sessionFrozen = false

    const dark = this.isDark()
    const win = new BrowserWindow({
      width: opts.bounds?.width ?? 1280, height: opts.bounds?.height ?? 820, x: opts.bounds?.x, y: opts.bounds?.y,
      minWidth: 420, minHeight: 320, show: false,
      backgroundColor: dark ? '#1b1c20' : '#f1f3f6',
      title: isPrivate ? 'Lumen (Private)' : 'Lumen',
      icon: this.paths.icon,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: dark ? '#1b1c20' : '#e6e9ee', symbolColor: dark ? '#e6e6e6' : '#222', height: TAB_H },
      webPreferences: {
        session: this.uiSession, preload: this.paths.chromePreload, contextIsolation: true, nodeIntegration: false, sandbox: true,
        additionalArguments: [`--lumen-window-private=${isPrivate ? 1 : 0}`],
      },
    })
    const w = new Win(win, profile, parentId)
    this.windows.set(win.id, w)
    this.lastFocused = w

    w.overlay = new WebContentsView({ webPreferences: { session: this.uiSession, preload: this.paths.chromePreload, contextIsolation: true, nodeIntegration: false, sandbox: true } })
    w.overlay.setBackgroundColor('#00000000')
    w.overlay.setVisible(false)
    w.overlay.webContents.loadFile(this.paths.overlayHtml).catch(() => {})
    win.contentView.addChildView(w.overlay)
    this.bindKeys(w.overlay.webContents, w)

    win.webContents.loadFile(this.paths.chromeHtml, { query: { window: String(win.id), private: isPrivate ? '1' : '0' } }).catch((e) => console.error('[window] load chrome', e))
    this.bindKeys(win.webContents, w)
    this.attachWindowEvents(w)

    // Tabs
    const restore = opts.restore
    if (restore && restore.tabs.length) {
      w.groups = restore.groups.map((g) => ({ ...g }))
      restore.tabs.forEach((t, i) => this.addTab(w, t.url, { active: i === restore.activeIndex, pinned: t.pinned, groupId: t.groupId, title: t.title, favicon: t.favicon, lazy: i !== restore.activeIndex, noActivate: true }))
      const target = w.tabs[Math.min(Math.max(restore.activeIndex, 0), w.tabs.length - 1)]
      if (target) this.activate(w, target.id)
    } else {
      const urls = opts.urls?.length ? opts.urls : [this.newTabUrl(profile)]
      urls.forEach((u, i) => this.addTab(w, u, { active: i === urls.length - 1 }))
    }
    if (restore?.maximized) win.maximize()
    win.once('ready-to-show', () => { win.show(); this.layout(w) })
    this.layout(w)
    return w
  }

  private attachWindowEvents(w: Win) {
    const win = w.win
    const relayout = () => { this.layout(w); this.post(w, 'window:maximized', win.isMaximized()) }
    win.on('resize', relayout); win.on('maximize', relayout); win.on('unmaximize', relayout)
    win.on('enter-full-screen', () => { w.fullscreen = true; this.layout(w); this.sendState(w) })
    win.on('leave-full-screen', () => { w.fullscreen = false; w.htmlFullscreenTab = null; this.layout(w); this.sendState(w) })
    win.on('focus', () => { this.lastFocused = w; const wc = w.active?.wc; if (wc) { try { this.extensionsFor(w.profile.id)?.api.selectTab(wc) } catch { /* private window */ } } })
    win.on('move', () => this.scheduleSessionSave())
    win.on('close', () => {
      const live = [...this.windows.values()].filter((x) => !x.isPrivate)
      if (!w.isPrivate && live.length === 1 && live[0] === w) { this.saveSessionNow(); this.sessionFrozen = true }
    })
    win.on('closed', () => {
      this.windows.delete(win.id)
      if (this.lastFocused === w) this.lastFocused = [...this.windows.values()].pop() ?? null
      for (const t of w.tabs) t.destroy()
      for (const p of w.prompts) p.resolve(null)
      w.currentPrompt?.resolve(null)
      if (w.isPrivate) void w.profile.destroyPrivate()
      this.scheduleSessionSave()
    })
    win.webContents.on('did-finish-load', () => this.sendState(w))
  }

  winForWebContents(wc: WebContents): Win | null {
    for (const w of this.windows.values()) {
      if (w.chrome === wc || w.overlay.webContents === wc || w.sidePanel?.webContents === wc) return w
      if (w.tabs.some((t) => t.wc === wc)) return w
    }
    return null
  }
  tabForWebContents(wc: WebContents): { w: Win; tab: Tab } | null {
    for (const w of this.windows.values()) { const tab = w.tabs.find((t) => t.wc === wc); if (tab) return { w, tab } }
    return null
  }
  focusedWin(): Win | null {
    const f = BrowserWindow.getFocusedWindow()
    return (f && this.windows.get(f.id)) || this.lastFocused || [...this.windows.values()][0] || null
  }

  isDark(): boolean {
    const t = this.settings.theme
    return t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors)
  }

  applyTheme() {
    nativeTheme.themeSource = this.settings.theme
    const dark = this.isDark()
    for (const w of this.windows.values()) {
      try { w.win.setTitleBarOverlay({ color: dark ? '#1b1c20' : '#e6e9ee', symbolColor: dark ? '#e6e6e6' : '#222', height: TAB_H }) } catch { /* not supported on this platform */ }
      w.win.setBackgroundColor(dark ? '#1b1c20' : '#f1f3f6')
    }
  }

  // ------------------------------------------------------------------ layout
  chromeHeight(w: Win) { return w.fullscreen ? 0 : TAB_H + TOOLBAR_H + (this.settings.showBookmarksBar ? BOOKMARKS_H : 0) }

  layout(w: Win) {
    if (w.win.isDestroyed()) return
    const [cw, ch] = w.win.getContentSize()
    const top = this.chromeHeight(w)
    const panelW = w.sidePanel && !w.fullscreen ? SIDE_PANEL_W : 0
    const pageBounds = { x: 0, y: top, width: Math.max(0, cw - panelW), height: Math.max(0, ch - top) }
    for (const t of w.tabs) t.view?.setBounds(pageBounds)
    w.sidePanel?.setBounds({ x: cw - panelW, y: top, width: panelW, height: Math.max(0, ch - top) })
    // Popups that must not block the rest of the window (address bar dropdown, find bar) only cover their own rectangle.
    const o = w.overlayOpen
    let ob = { x: 0, y: 0, width: cw, height: ch }
    if (o?.kind === 'suggestions') ob = { x: Math.round(o.anchor.x), y: Math.round(o.anchor.y + o.anchor.height), width: o.width, height: o.height }
    else if (o?.kind === 'find' || o?.kind === 'zoom') ob = { x: Math.max(0, cw - panelW - o.width - 16), y: top + 6, width: o.width, height: o.height }
    w.overlay.setBounds(ob)
  }

  // ------------------------------------------------------------------ tabs
  newTabUrl(profile: ProfileContext): string {
    const override = this.extensionsFor(profile.id)?.api.getURLOverrides().newtab
    return override || 'lumen://newtab'
  }

  addTab(w: Win, url: string, o: { active?: boolean; pinned?: boolean; groupId?: string | null; index?: number; afterId?: number; title?: string; favicon?: string; lazy?: boolean; noActivate?: boolean } = {}): Tab {
    const host = this.hostFor(w)
    const tab = new Tab(host, { url, title: o.title, favicon: o.favicon, pinned: o.pinned, groupId: o.groupId, discarded: !!o.lazy })
    let index = o.index ?? (o.afterId != null ? w.tabs.findIndex((t) => t.id === o.afterId) + 1 : w.tabs.length)
    if (index < 0) index = w.tabs.length
    if (!tab.pinned) index = Math.max(index, w.tabs.filter((t) => t.pinned).length)
    w.tabs.splice(index, 0, tab)
    if (tab.groupId && !w.groups.some((g) => g.id === tab.groupId)) tab.groupId = null
    if (!o.lazy) {
      const view = tab.ensureView()
      w.win.contentView.addChildView(view)
      w.win.contentView.addChildView(w.overlay) // keep the overlay on top
      view.setVisible(false)
    }
    this.normalize(w)
    this.layout(w)
    if (o.active !== false && !o.noActivate) this.activate(w, tab.id)
    else this.onTabChanged(w, tab, false)
    return tab
  }

  /** Create a view for a lazily-restored or discarded tab. */
  private wake(w: Win, tab: Tab) {
    if (tab.view && tab.wc) return
    const view = tab.ensureView()
    w.win.contentView.addChildView(view)
    w.win.contentView.addChildView(w.overlay)
    this.layout(w)
  }

  activate(w: Win, id: number) {
    const tab = w.tabs.find((t) => t.id === id)
    if (!tab) return
    const prev = w.active
    if (prev && prev !== tab) { prev.view?.setVisible(false); prev.lastActive = Date.now() }
    w.activeId = id
    if (!tab.view || !tab.wc) this.wake(w, tab)
    else if (tab.crashed) { tab.crashed = false; tab.wc?.reload() }
    tab.lastActive = Date.now()
    tab.view!.setVisible(true)
    this.layout(w)
    const wc = tab.wc
    if (wc) { try { this.extensionsFor(w.profile.id)?.api.selectTab(wc) } catch { /* private window */ } }
    if (!w.overlayOpen) wc?.focus()
    // Expand a collapsed group when one of its tabs becomes active.
    const g = tab.groupId ? w.groups.find((x) => x.id === tab.groupId) : null
    if (g?.collapsed) g.collapsed = false
    this.sendState(w)
    this.scheduleSessionSave()
  }

  closeTab(w: Win, id: number, opts: { record?: boolean } = {}) {
    const idx = w.tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    const tab = w.tabs[idx]
    const url = tab.wc?.getURL() || tab.url
    if (opts.record !== false && !w.isPrivate && url && !url.startsWith('lumen://newtab') && url !== 'about:blank') {
      const rec = { url, title: tab.title, pinned: tab.pinned, groupId: tab.groupId }
      w.profile.data.d.closedTabs.unshift({ url, title: tab.title, pinned: tab.pinned, groupId: tab.groupId })
      w.profile.data.d.closedTabs.length = Math.min(w.profile.data.d.closedTabs.length, 25)
      w.profile.data.save()
      w.closedStack.unshift(rec)
    }
    if (w.tabs.length === 1) { tab.destroy(); w.tabs.splice(idx, 1); w.win.close(); return }
    const wasActive = w.activeId === id
    if (tab.view) w.win.contentView.removeChildView(tab.view)
    const wc = tab.wc
    if (wc) { try { this.extensionsFor(w.profile.id)?.api.removeTab(wc) } catch { /* ignore */ } }
    tab.destroy()
    w.tabs.splice(idx, 1)
    // Drop groups that became empty.
    w.groups = w.groups.filter((g) => w.tabs.some((t) => t.groupId === g.id))
    if (wasActive) {
      const next = w.tabs[Math.min(idx, w.tabs.length - 1)]
      if (next) this.activate(w, next.id)
    }
    this.sendState(w)
    this.scheduleSessionSave()
  }

  restoreClosedTab(w: Win) {
    const rec = w.profile.data.d.closedTabs.shift() ?? w.closedStack.shift()
    if (!rec) return
    w.closedStack = w.closedStack.filter((r) => r.url !== rec.url)
    w.profile.data.save()
    const groupId = rec.groupId && w.groups.some((g) => g.id === rec.groupId) ? rec.groupId : null
    this.addTab(w, rec.url, { pinned: rec.pinned, groupId })
  }

  duplicateTab(w: Win, id: number) {
    const t = w.tabs.find((x) => x.id === id)
    if (!t) return
    this.addTab(w, t.wc?.getURL() || t.url, { afterId: id, groupId: t.groupId, pinned: false, title: t.title, favicon: t.favicon })
  }

  setPinned(w: Win, id: number, pinned: boolean) {
    const t = w.tabs.find((x) => x.id === id)
    if (!t) return
    t.pinned = pinned
    if (pinned) t.groupId = null
    // Move to the boundary of the pinned region.
    w.tabs.splice(w.tabs.indexOf(t), 1)
    const pinnedCount = w.tabs.filter((x) => x.pinned).length
    w.tabs.splice(pinned ? pinnedCount : pinnedCount, 0, t)
    this.normalize(w); this.sendState(w); this.scheduleSessionSave()
  }

  setMuted(w: Win, id: number, muted: boolean) {
    const t = w.tabs.find((x) => x.id === id)
    if (!t) return
    t.muted = muted; t.wc?.setAudioMuted(muted); this.sendState(w)
  }

  moveTab(w: Win, id: number, toIndex: number, groupId?: string | null) {
    const t = w.tabs.find((x) => x.id === id)
    if (!t) return
    const from = w.tabs.indexOf(t)
    w.tabs.splice(from, 1)
    const pinnedCount = w.tabs.filter((x) => x.pinned).length
    let idx = Math.max(0, Math.min(toIndex, w.tabs.length))
    idx = t.pinned ? Math.min(idx, pinnedCount) : Math.max(idx, pinnedCount)
    w.tabs.splice(idx, 0, t)
    if (groupId !== undefined && !t.pinned) t.groupId = groupId && w.groups.some((g) => g.id === groupId) ? groupId : null
    w.groups = w.groups.filter((g) => w.tabs.some((x) => x.groupId === g.id))
    this.normalize(w); this.sendState(w); this.scheduleSessionSave()
  }

  /** Keep pinned tabs first and every group's tabs contiguous. */
  private normalize(w: Win) {
    const pinned = w.tabs.filter((t) => t.pinned)
    const rest = w.tabs.filter((t) => !t.pinned)
    const out: Tab[] = [...pinned]
    const seen = new Set<string>()
    for (const t of rest) {
      if (t.groupId) {
        if (seen.has(t.groupId)) continue
        seen.add(t.groupId)
        out.push(...rest.filter((x) => x.groupId === t.groupId))
      } else out.push(t)
    }
    w.tabs = out
  }

  createGroup(w: Win, tabIds: number[], name = '', color?: string): TabGroup | null {
    const tabs = w.tabs.filter((t) => tabIds.includes(t.id) && !t.pinned)
    if (!tabs.length) return null
    const g: TabGroup = { id: randomUUID(), name, color: color ?? GROUP_COLORS[w.groups.length % GROUP_COLORS.length], collapsed: false }
    w.groups.push(g)
    for (const t of tabs) t.groupId = g.id
    w.groups = w.groups.filter((x) => w.tabs.some((t) => t.groupId === x.id))
    this.normalize(w); this.sendState(w); this.scheduleSessionSave()
    return g
  }

  updateGroup(w: Win, id: string, patch: Partial<Pick<TabGroup, 'name' | 'color' | 'collapsed'>>) {
    const g = w.groups.find((x) => x.id === id)
    if (!g) return
    if (patch.name !== undefined) g.name = patch.name.slice(0, 40)
    if (patch.color !== undefined) g.color = patch.color
    if (patch.collapsed !== undefined) {
      g.collapsed = patch.collapsed
      // The active tab can never be hidden; collapsing its group moves focus to the nearest tab outside it.
      const a = w.active
      if (g.collapsed && a?.groupId === id) {
        const other = w.tabs.find((t) => t.groupId !== id)
        if (other) this.activate(w, other.id)
      }
    }
    this.sendState(w); this.scheduleSessionSave()
  }

  ungroup(w: Win, groupId: string) {
    for (const t of w.tabs) if (t.groupId === groupId) t.groupId = null
    w.groups = w.groups.filter((g) => g.id !== groupId)
    this.sendState(w); this.scheduleSessionSave()
  }

  closeGroup(w: Win, groupId: string) {
    for (const t of w.tabs.filter((x) => x.groupId === groupId)) this.closeTab(w, t.id)
  }

  addToGroup(w: Win, tabId: number, groupId: string | null) {
    const t = w.tabs.find((x) => x.id === tabId)
    if (!t || t.pinned) return
    t.groupId = groupId && w.groups.some((g) => g.id === groupId) ? groupId : null
    w.groups = w.groups.filter((g) => w.tabs.some((x) => x.groupId === g.id))
    this.normalize(w); this.sendState(w); this.scheduleSessionSave()
  }

  cycle(w: Win, delta: number) {
    const visible = w.tabs.filter((t) => !t.groupId || !w.groups.find((g) => g.id === t.groupId)?.collapsed || t.id === w.activeId)
    if (!visible.length) return
    const i = visible.findIndex((t) => t.id === w.activeId)
    this.activate(w, visible[(i + delta + visible.length) % visible.length].id)
  }

  private discardIdleTabs() {
    const minutes = this.settings.backgroundTabSleepMinutes
    if (!minutes) return
    const limit = Date.now() - minutes * 60_000
    for (const w of this.windows.values()) {
      for (const t of w.tabs) {
        if (t.id === w.activeId || !t.wc || t.lastActive > limit || t.audible || t.loading) continue
        if (t.wc.isDevToolsOpened() || t.wc.isCrashed()) continue
        const wc = t.wc
        try { this.extensionsFor(w.profile.id)?.api.removeTab(wc) } catch { /* ignore */ }
        if (t.view) w.win.contentView.removeChildView(t.view)
        t.discard()
        this.sendState(w)
      }
    }
  }

  // ------------------------------------------------------------------ navigation
  searchTemplate(): string {
    const s = this.settings
    if (s.searchEngine === 'custom') return s.customSearchUrl.includes('%s') ? s.customSearchUrl : SEARCH_ENGINES.duckduckgo.url
    return (SEARCH_ENGINES[s.searchEngine] ?? SEARCH_ENGINES.duckduckgo).url
  }

  navigate(w: Win, input: string, opts: { newTab?: boolean } = {}) {
    const r = resolveInput(input, this.searchTemplate())
    let url = r.url
    if (url === 'lumen://newtab') url = this.newTabUrl(w.profile)
    if (opts.newTab || !w.active) { this.addTab(w, url); return }
    const t = w.active
    if (!t.wc) this.wake(w, t)
    t.url = url
    t.navigate(url)
    t.wc?.focus()
    this.sendState(w)
  }

  home(w: Win) {
    const home = this.settings.homepage || 'lumen://newtab'
    this.navigate(w, home)
  }

  // ------------------------------------------------------------------ state to the UI
  sendState(w: Win) {
    if (w.stateTimer) return
    w.stateTimer = setTimeout(() => {
      w.stateTimer = null
      if (w.win.isDestroyed()) return
      this.post(w, 'state', this.buildState(w))
    }, 16)
  }

  buildState(w: Win): WindowState {
    return {
      windowId: w.id, profileId: w.parentProfileId, isPrivate: w.isPrivate, tabs: w.tabs.map((t) => t.state()), groups: w.groups, activeTabId: w.activeId,
      fullscreen: w.fullscreen, maximized: w.win.isMaximized(), canRestoreTab: w.profile.data.d.closedTabs.length > 0 || w.closedStack.length > 0,
      sidePanelOpen: !!w.sidePanel,
    }
  }

  post(w: Win, channel: string, ...args: unknown[]) {
    if (!w.win.isDestroyed() && !w.chrome.isDestroyed()) w.chrome.send(channel, ...args)
  }

  broadcast(channel: string, ...args: unknown[]) {
    for (const w of this.windows.values()) {
      this.post(w, channel, ...args)
      if (!w.overlay.webContents.isDestroyed()) w.overlay.webContents.send(channel, ...args)
      for (const t of w.tabs) if (t.wc && t.url.startsWith('lumen://')) t.wc.send(channel, ...args)
      if (w.sidePanel && !w.sidePanel.webContents.isDestroyed()) w.sidePanel.webContents.send(channel, ...args)
    }
  }

  // ------------------------------------------------------------------ TabHost
  hostFor(w: Win): TabHost {
    const self = this
    return {
      profile: w.profile, adblock: this.adblock, pagePreload: this.paths.pagePreload, isPrivate: w.isPrivate,
      settingsHistoryEnabled: () => self.settings.historyEnabled,
      settingsReportAsChrome: () => self.settings.reportAsChrome,
      getZoom: (host) => w.profile.data.d.zoom[host],
      setZoom: (host, level) => { if (!host) return; if (level === 0) delete w.profile.data.d.zoom[host]; else w.profile.data.d.zoom[host] = level; w.profile.data.save() },
      changed: (tab, urlChanged) => { self.onTabChanged(w, tab, !!urlChanged) },
      openTab: (url, o) => { self.addTab(w, url, { active: o.active, afterId: o.opener?.id, groupId: o.opener?.groupId ?? undefined }) },
      openPopupWindow: () => {},
      contextMenu: (tab, params) => self.showContextMenu(w, tab, params),
      keyDown: (_tab, input, event) => self.handleKey(w, input, event),
      found: (tab, r) => { if (tab.id === w.activeId) w.overlay.webContents.send('find:result', r) },
      htmlFullscreen: (tab, on) => self.htmlFullscreen(w, tab, on),
      confirmExternal: async (tab, url) => {
        const origin = originOf(tab.wc?.getURL() ?? '')
        const cur = w.profile.currentValue(origin, 'openExternal')
        if (cur === 'allow') return true
        if (cur === 'block') return false
        const r = await self.askPermission(tab.wc, 'openExternal', origin, `open ${url.split(':')[0]}: links in another application`)
        if (r.remember) w.profile.data.setSitePermission(origin, 'openExternal', r.allow ? 'allow' : 'block')
        return r.allow
      },
      popupAllowed: (origin) => w.profile.currentValue(origin, 'popups') === 'allow',
      registerWithExtensions: (tab) => { if (!w.isPrivate && tab.wc) { try { self.extensionsFor(w.profile.id)?.api.addTab(tab.wc, w.win) } catch (e) { console.warn('[extensions] addTab', e) } } },
    }
  }

  private htmlFullscreen(w: Win, tab: Tab, on: boolean) {
    if (on) { w.htmlFullscreenTab = tab; w.win.setFullScreen(true) }
    else if (w.htmlFullscreenTab) { w.htmlFullscreenTab = null; w.win.setFullScreen(false) }
  }

  private onTabChanged(w: Win, tab: Tab, urlChanged: boolean) {
    this.sendState(w)
    if (urlChanged) this.scheduleSessionSave()
    if (tab.id === w.activeId && !w.overlay.webContents.isDestroyed()) w.overlay.webContents.send('tab:changed')
  }

  // ------------------------------------------------------------------ extension host adapter
  private makeExtensionHost(): ExtensionHost {
    const self = this
    return {
      async createTab(details) {
        const w = (details.windowId != null && [...self.windows.values()].find((x) => x.id === details.windowId)) || self.focusedNonPrivate()
        if (!w) throw new Error('No window available')
        const tab = self.addTab(w, details.url || self.newTabUrl(w.profile), { active: details.active !== false, pinned: details.pinned, index: details.index })
        if (!tab.wc) self.wake(w, tab)
        return [tab.wc!, w.win]
      },
      selectTab(wc) { const f = self.tabForWebContents(wc); if (f) self.activate(f.w, f.tab.id) },
      removeTab(wc) { const f = self.tabForWebContents(wc); if (f) self.closeTab(f.w, f.tab.id, { record: false }) },
      async createWindow(details) {
        const urls = Array.isArray(details.url) ? details.url : details.url ? [details.url] : undefined
        return (await self.createWindow({ urls, profileId: self.focusedNonPrivate()?.parentProfileId })).win
      },
      removeWindow(win) { win.close() },
      assignTabDetails(details, wc) {
        const f = self.tabForWebContents(wc)
        if (!f) return
        details.pinned = f.tab.pinned
        details.discarded = f.tab.discarded
        ;(details as any).groupId = f.tab.groupId ? Math.abs(hashCode(f.tab.groupId)) : -1
      },
      openUrl(profileId, url) {
        const w = [...self.windows.values()].find((x) => x.parentProfileId === profileId && !x.isPrivate) ?? self.focusedNonPrivate()
        if (w) self.addTab(w, url)
      },
    }
  }

  private focusedNonPrivate(): Win | null {
    const f = this.focusedWin()
    if (f && !f.isPrivate) return f
    return [...this.windows.values()].find((x) => !x.isPrivate) ?? null
  }

  // ------------------------------------------------------------------ side panel and overlays
  toggleSidePanel(w: Win, page?: 'bookmarks' | 'history' | 'downloads') {
    const target = page ?? this.settings.sidePanelPage
    if (w.sidePanel && !page) { this.closeSidePanel(w); return }
    if (page) { this.settings.sidePanelPage = page; this.data.settings.save() }
    if (!w.sidePanel) {
      const view = new WebContentsView({ webPreferences: { session: w.profile.session, preload: this.paths.pagePreload, contextIsolation: true, nodeIntegration: false, sandbox: true } })
      w.sidePanel = view
      w.win.contentView.addChildView(view)
      w.win.contentView.addChildView(w.overlay)
      this.bindKeys(view.webContents, w)
    }
    w.sidePanel.webContents.loadURL(`lumen://${target}/?panel=1`).catch(() => {})
    this.layout(w); this.sendState(w)
  }
  closeSidePanel(w: Win) {
    if (!w.sidePanel) return
    w.win.contentView.removeChildView(w.sidePanel)
    try { w.sidePanel.webContents.close() } catch { /* ignore */ }
    w.sidePanel = null
    this.layout(w); this.sendState(w)
  }

  showOverlay(w: Win, req: OverlayRequest) {
    w.overlayOpen = req
    w.win.contentView.removeChildView(w.overlay)
    w.win.contentView.addChildView(w.overlay) // raise above everything
    this.layout(w)
    w.overlay.setVisible(true)
    w.overlay.webContents.send('overlay:show', req)
    if (req.focus !== false) w.overlay.webContents.focus()
  }

  hideOverlay(w: Win) {
    if (!w.overlayOpen) return
    w.overlayOpen = null
    w.overlay.setVisible(false)
    w.overlay.webContents.send('overlay:hide')
    w.active?.wc?.focus()
  }

  private pumpPrompts(w: Win) {
    if (w.currentPrompt || !w.prompts.length) return
    const next = w.prompts.shift()!
    w.currentPrompt = next
    this.showOverlay(w, { kind: 'prompt', anchor: { x: 0, y: 0, width: 0, height: 0 }, width: 460, height: next.req.kind === 'screenshare' ? 420 : next.req.kind === 'password' ? 170 : 190, props: { request: next.req } })
  }

  resolvePrompt(w: Win, id: string, value: unknown) {
    if (w.currentPrompt?.req.id !== id) return
    const cur = w.currentPrompt
    w.currentPrompt = null
    this.hideOverlay(w)
    cur.resolve(value)
    this.pumpPrompts(w)
  }

  private enqueue<T>(w: Win, req: PromptRequest): Promise<T> {
    return new Promise<T>((resolve) => { w.prompts.push({ req, resolve }); this.pumpPrompts(w) })
  }

  async askPermission(wc: WebContents | null, kind: PermissionKind, origin: string, label: string): Promise<{ allow: boolean; remember: boolean }> {
    const w = wc ? this.winForWebContents(wc) : this.focusedWin()
    if (!w) return { allow: false, remember: false }
    const r = await this.enqueue<{ allow: boolean; remember: boolean } | null>(w, { id: randomUUID(), kind: 'permission', origin, permission: kind, label })
    return r ?? { allow: false, remember: false }
  }

  /** Resolves true when the user chooses to save (or update) the password. */
  async askPassword(w: Win, origin: string, username: string, update: boolean): Promise<boolean> {
    const r = await this.enqueue<boolean | null>(w, { id: randomUUID(), kind: 'password', origin, username, update })
    return !!r
  }

  allowCertificate(host: string) { if (host) this.certExceptions.add(host) }
  isCertificateAllowed(host: string) { return this.certExceptions.has(host) }

  async askScreen(wc: WebContents | null, origin: string, sources: { id: string; name: string; thumbnail: string }[]): Promise<string | null> {
    const w = wc ? this.winForWebContents(wc) : this.focusedWin()
    if (!w) return null
    return (await this.enqueue<string | null>(w, { id: randomUUID(), kind: 'screenshare', origin, sources })) ?? null
  }

  // ------------------------------------------------------------------ keyboard
  rebuildShortcuts() {
    const custom = this.settings.shortcuts
    const out: { id: string; acc: Accel }[] = []
    for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
      // A custom value replaces the default; an empty string disables the shortcut.
      const accel = custom[id] !== undefined ? custom[id] : def
      const acc = parseAccelerator(accel, process.platform)
      if (acc) out.push({ id, acc })
    }
    this.accels = out
  }

  private bindKeys(wc: WebContents, w: Win) {
    wc.on('before-input-event', (event, input) => { if (input.type === 'keyDown') this.handleKey(w, input, event) })
  }

  handleKey(w: Win, input: Input, event: Electron.Event) {
    if (input.isAutoRepeat && input.key !== 'Tab') return
    for (const { id, acc } of this.accels) {
      if (!matches({ key: input.key, control: input.control, shift: input.shift, alt: input.alt, meta: input.meta }, acc)) continue
      // Escape only stops loading when a page is loading, otherwise it must reach the page (closing dialogs, exiting video fullscreen).
      if (id === 'nav.stop' && !w.active?.loading) return
      if (w.overlayOpen && id !== 'nav.stop' && w.overlayOpen.kind === 'prompt') return
      event.preventDefault()
      this.exec(w, baseAction(id))
      return
    }
  }

  exec(w: Win, action: string, arg?: unknown) {
    const t = w.active
    const wc = t?.wc
    switch (action) {
      case 'tab.new': this.addTab(w, this.newTabUrl(w.profile)); this.post(w, 'cmd:focusAddress'); break
      case 'tab.close': if (t) this.closeTab(w, t.id); break
      case 'tab.restore': this.restoreClosedTab(w); break
      case 'tab.next': this.cycle(w, 1); break
      case 'tab.prev': this.cycle(w, -1); break
      case 'tab.duplicate': if (t) this.duplicateTab(w, t.id); break
      case 'tab.pin': if (t) this.setPinned(w, t.id, !t.pinned); break
      case 'tab.mute': if (t) this.setMuted(w, t.id, !t.muted); break
      case 'tab.selectLast': if (w.tabs.length) this.activate(w, w.tabs[w.tabs.length - 1].id); break
      case 'nav.focusAddress': this.hideOverlay(w); w.chrome.focus(); this.post(w, 'cmd:focusAddress'); break
      case 'nav.reload': if (t) { if (t.error) t.navigate(t.url); else wc?.reload() } break
      case 'nav.hardReload': wc?.reloadIgnoringCache(); break
      case 'nav.stop': wc?.stop(); break
      case 'nav.back': if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break
      case 'nav.forward': if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break
      case 'nav.home': this.home(w); break
      case 'page.bookmark': this.post(w, 'cmd:bookmark'); break
      case 'page.find': this.showOverlay(w, { kind: 'find', anchor: { x: 0, y: 0, width: 0, height: 0 }, width: 380, height: 52 }); break
      case 'suggestion.pick': this.post(w, 'suggestion:pick', arg); break
      case 'page.print': wc?.print(); break
      case 'page.devtools': if (wc) { wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' }) } break
      case 'page.viewSource': if (wc) this.addTab(w, `view-source:${wc.getURL()}`, { afterId: t!.id }); break
      case 'page.zoomIn': if (t && wc) t.applyZoom(Math.min(5, wc.getZoomLevel() + 0.5)); this.post(w, 'cmd:zoomBubble'); break
      case 'page.zoomOut': if (t && wc) t.applyZoom(Math.max(-3, wc.getZoomLevel() - 0.5)); this.post(w, 'cmd:zoomBubble'); break
      case 'page.zoomReset': if (t) t.applyZoom(0); this.post(w, 'cmd:zoomBubble'); break
      case 'view.fullscreen': w.win.setFullScreen(!w.win.isFullScreen()); break
      case 'view.bookmarksBar': this.settings.showBookmarksBar = !this.settings.showBookmarksBar; this.data.settings.save(); this.broadcastSettings(); break
      case 'view.sidePanel': this.toggleSidePanel(w); break
      case 'win.new': void this.createWindow({ profileId: w.parentProfileId }); break
      case 'win.private': void this.createWindow({ private: true, profileId: w.parentProfileId }); break
      case 'open.history': this.addTab(w, 'lumen://history'); break
      case 'open.downloads': this.addTab(w, 'lumen://downloads'); break
      case 'open.bookmarks': this.addTab(w, 'lumen://bookmarks'); break
      case 'open.settings': this.addTab(w, 'lumen://settings'); break
      case 'open.extensions': this.addTab(w, 'lumen://extensions'); break
      case 'open.clearData': this.addTab(w, 'lumen://settings/#clear'); break
      default: {
        const m = /^tab\.select([1-8])$/.exec(action)
        if (m) { const tab = w.tabs[Number(m[1]) - 1]; if (tab) this.activate(w, tab.id) } else console.warn('[exec] unknown action', action, arg)
      }
    }
  }

  broadcastSettings() {
    for (const w of this.windows.values()) { this.layout(w); this.sendState(w) }
    this.broadcast('settings:changed', this.settings)
    this.applyTheme()
  }

  // ------------------------------------------------------------------ context menu
  private showContextMenu(w: Win, tab: Tab, p: ContextMenuParams) {
    const wc = tab.wc
    if (!wc) return
    const m = new Menu()
    const add = (label: string, click: () => void, enabled = true) => m.append(new MenuItem({ label, click, enabled }))
    const sep = () => m.append(new MenuItem({ type: 'separator' }))

    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) add(s, () => wc.replaceMisspelling(s))
      if (!p.dictionarySuggestions.length) add('No suggestions', () => {}, false)
      add('Add to dictionary', () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord))
      sep()
    }
    if (p.linkURL) {
      add('Open link in new tab', () => this.addTab(w, p.linkURL, { active: false, afterId: tab.id, groupId: tab.groupId }))
      add('Open link in new window', () => void this.createWindow({ urls: [p.linkURL], profileId: w.parentProfileId, private: w.isPrivate }))
      add('Open link in private window', () => void this.createWindow({ urls: [p.linkURL], private: true, profileId: w.parentProfileId }))
      add('Save link as...', () => wc.downloadURL(p.linkURL))
      add('Copy link address', () => clipboard.writeText(p.linkURL))
      sep()
    }
    if (p.mediaType === 'image' && p.srcURL) {
      add('Open image in new tab', () => this.addTab(w, p.srcURL, { afterId: tab.id }))
      add('Save image as...', () => wc.downloadURL(p.srcURL))
      add('Copy image', () => wc.copyImageAt(p.x, p.y))
      add('Copy image address', () => clipboard.writeText(p.srcURL))
      sep()
    }
    if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL) {
      add('Save media as...', () => wc.downloadURL(p.srcURL))
      add('Copy media address', () => clipboard.writeText(p.srcURL))
      sep()
    }
    if (p.isEditable) {
      add('Undo', () => wc.undo(), p.editFlags.canUndo); add('Redo', () => wc.redo(), p.editFlags.canRedo); sep()
      add('Cut', () => wc.cut(), p.editFlags.canCut); add('Copy', () => wc.copy(), p.editFlags.canCopy); add('Paste', () => wc.paste(), p.editFlags.canPaste)
      add('Paste as plain text', () => wc.pasteAndMatchStyle(), p.editFlags.canPaste); add('Select all', () => wc.selectAll(), p.editFlags.canSelectAll)
      sep()
    } else if (p.selectionText) {
      add('Copy', () => wc.copy())
      const q = p.selectionText.trim().slice(0, 100)
      add(`Search for "${q.length > 30 ? q.slice(0, 30) + '...' : q}"`, () => this.addTab(w, searchUrl(this.searchTemplate(), q), { afterId: tab.id }))
      sep()
    }
    if (!p.linkURL && !p.isEditable && !p.selectionText && p.mediaType === 'none') {
      add('Back', () => wc.navigationHistory.goBack(), wc.navigationHistory.canGoBack())
      add('Forward', () => wc.navigationHistory.goForward(), wc.navigationHistory.canGoForward())
      add('Reload', () => wc.reload())
      sep()
      add('Save page as...', async () => {
        const r = await dialog.showSaveDialog(w.win, { defaultPath: `${(tab.title || 'page').replace(/[<>:"/\\|?*]/g, '_')}.html`, filters: [{ name: 'Web page', extensions: ['html'] }] })
        if (!r.canceled && r.filePath) wc.savePage(r.filePath, 'HTMLComplete').catch((e) => dialog.showErrorBox('Save page failed', String(e?.message ?? e)))
      })
      add('Print...', () => wc.print())
      sep()
    }
    // Items contributed by extensions.
    if (!w.isPrivate) {
      try { const items = this.extensionsFor(w.profile.id)?.api.getContextMenuItems(wc, p) ?? []; if (items.length) { items.forEach((i) => m.append(i)); sep() } } catch { /* ignore */ }
    }
    add('View page source', () => this.addTab(w, `view-source:${wc.getURL()}`, { afterId: tab.id }))
    add('Inspect', () => { wc.inspectElement(p.x, p.y); if (wc.isDevToolsOpened()) wc.devToolsWebContents?.focus() })
    m.popup({ window: w.win })
  }

  // ------------------------------------------------------------------ session persistence
  private snapshot(): SavedWindow[] {
    return [...this.windows.values()].filter((w) => !w.isPrivate).map((w) => {
      const tabs = w.tabs.filter((t) => !t.url.startsWith('lumen://error'))
      return {
        profileId: w.parentProfileId,
        tabs: tabs.map((t) => ({ url: t.wc?.getURL() || t.url, title: t.title, pinned: t.pinned, groupId: t.groupId, favicon: t.favicon })),
        groups: w.groups, activeIndex: Math.max(0, tabs.findIndex((t) => t.id === w.activeId)),
        bounds: w.win.isMaximized() || w.win.isFullScreen() ? undefined : w.win.getBounds(), maximized: w.win.isMaximized(),
      }
    })
  }

  scheduleSessionSave() {
    if (this.sessionTimer || this.sessionFrozen) return
    this.sessionTimer = setTimeout(() => { this.sessionTimer = null; this.saveSessionNow() }, 800)
  }

  saveSessionNow() {
    if (this.sessionFrozen) return
    if (this.sessionTimer) { clearTimeout(this.sessionTimer); this.sessionTimer = null }
    const windows = this.snapshot()
    this.data.session.data.windows = windows
    this.data.session.save()
  }

  markCleanExit() {
    this.data.session.data.cleanExit = true
    this.data.session.flush()
  }
}

/** Secondary bindings are named with a trailing 2 (nav.reload2 -> nav.reload); tab.select2 is a real action. */
export function baseAction(id: string): string {
  return /^tab\.select/.test(id) ? id : id.replace(/2$/, '')
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
