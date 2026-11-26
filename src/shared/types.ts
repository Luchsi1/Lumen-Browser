// Types shared between main process, preload scripts and renderers.

export type ThemeMode = 'system' | 'light' | 'dark'
export type PermissionKind = 'media' | 'geolocation' | 'notifications' | 'popups' | 'clipboard-read' | 'fullscreen' | 'midi' | 'openExternal' | 'screen'
export type PermissionValue = 'ask' | 'allow' | 'block'

export interface FilterListConfig {
  id: string
  name: string
  url: string
  enabled: boolean
  builtin: boolean
  category: 'ads' | 'privacy' | 'security' | 'annoyances' | 'custom'
  description?: string
}

export interface AdblockSettings {
  enabled: boolean
  cosmetic: boolean
  popupBlocking: boolean
  redirectBlocking: boolean
  strictThirdParty: boolean // block third-party scripts and frames not covered by an exception
  autoUpdate: boolean
  updateIntervalHours: number
  allowlist: string[]
  customRules: string
  lists: FilterListConfig[]
}

export interface Settings {
  startup: 'newtab' | 'home' | 'restore'
  homepage: string
  searchEngine: string
  customSearchUrl: string
  theme: ThemeMode
  accent: string
  showBookmarksBar: boolean
  toolbar: { home: boolean; bookmark: boolean; extensions: boolean; downloads: boolean; adblock: boolean; profile: boolean; sidePanel: boolean }
  trackingProtection: boolean
  blockThirdPartyCookies: boolean
  sendDoNotTrack: boolean
  httpsUpgrade: boolean
  searchSuggestions: boolean
  offerToSavePasswords: boolean
  historyEnabled: boolean
  permissionDefaults: Record<PermissionKind, PermissionValue>
  downloadDir: string
  askDownloadLocation: boolean
  hardwareAcceleration: boolean
  /** Send Chrome-compatible browser hints (needed for Google sign-in). */
  reportAsChrome: boolean
  backgroundTabSleepMinutes: number // 0 disables discarding
  adblock: AdblockSettings
  shortcuts: Record<string, string>
  hideExtensions: boolean
  pinnedExtensions: string[]
  sidePanelPage: 'bookmarks' | 'history' | 'downloads'
}

export interface TabGroup { id: string; name: string; color: string; collapsed: boolean }

export interface TabState {
  id: number // stable tab id (survives discarding)
  wcId: number // current WebContents id, used by chrome.* extension APIs; 0 while discarded
  url: string
  title: string
  favicon: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  audible: boolean
  muted: boolean
  pinned: boolean
  groupId: string | null
  security: 'secure' | 'insecure' | 'internal' | 'error' | 'file'
  discarded: boolean
  crashed: boolean
  blockedCount: number
  popupBlocked: number
  zoom: number
  error?: { code: number; description: string }
}

export interface WindowState {
  windowId: number
  profileId: string
  isPrivate: boolean
  tabs: TabState[]
  groups: TabGroup[]
  activeTabId: number | null
  fullscreen: boolean
  maximized: boolean
  canRestoreTab: boolean
  sidePanelOpen: boolean
}

export interface Bookmark {
  id: string
  type: 'bookmark' | 'folder'
  parentId: string | null
  title: string
  url?: string
  favicon?: string
  createdAt: number
  index: number
}

export interface HistoryEntry { id: string; url: string; title: string; visitedAt: number; visitCount: number; favicon?: string }

export type DownloadStatus = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'
export interface DownloadRecord {
  id: string
  url: string
  filename: string
  savePath: string
  mime: string
  totalBytes: number
  receivedBytes: number
  status: DownloadStatus
  canResume: boolean
  startedAt: number
  endedAt?: number
  bytesPerSecond: number
  etaSeconds: number | null
  error?: string
  exists?: boolean
}

export interface ProfileInfo { id: string; name: string; color: string }

export interface BlockedRequestInfo { url: string; type: string; filter: string; time: number; tabId: number }
export interface SiteBlockStats {
  host: string
  enabled: boolean // protection active on this site
  globalEnabled: boolean
  blockedOnPage: number
  blockedSession: number
  recent: BlockedRequestInfo[]
  byDomain: Record<string, number>
}

export interface FilterListStatus {
  id: string
  lastUpdated: number | null
  ruleCount: number
  error?: string
  updating?: boolean
}

export interface AdblockStatus {
  ready: boolean
  totalRules: number
  networkRules: number
  cosmeticRules: number
  statuses: FilterListStatus[]
  sessionBlocked: number
  lastUpdate: number | null
  customRuleErrors: string[]
  /** Scriptlets and redirect resources loaded for `##+js()` rules; 0 means those rules are inactive. */
  scriptletCount: number
  scriptletError?: string
}

export type CompatLevel = 'full' | 'partial' | 'limited' | 'unsupported'
export interface CompatIssue { level: 'info' | 'warning' | 'error'; message: string }
export interface ExtensionInfo {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  source: 'unpacked' | 'package' | 'webstore'
  path: string
  manifestVersion: number
  permissions: string[]
  hostPermissions: string[]
  optionsUrl?: string
  hasAction: boolean
  pinned: boolean
  compat: CompatLevel
  issues: CompatIssue[]
  loadError?: string
  iconUrl?: string
}
export interface ExtensionLogEntry { time: number; level: string; message: string; source?: string }

export interface PasswordEntry { id: string; origin: string; username: string; createdAt: number }

export interface SiteInfo {
  url: string
  origin: string
  host: string
  security: TabState['security']
  cookieCount: number
  permissions: Partial<Record<PermissionKind, PermissionValue>>
}

export interface SuggestionItem {
  type: 'search' | 'url' | 'history' | 'bookmark' | 'remote'
  text: string
  title?: string
  url?: string
  favicon?: string
}

export type PromptRequest =
  | { id: string; kind: 'permission'; origin: string; permission: PermissionKind; label: string }
  | { id: string; kind: 'screenshare'; origin: string; sources: { id: string; name: string; thumbnail: string }[] }
  | { id: string; kind: 'password'; origin: string; username: string; update: boolean }

export interface StorageUsage { cacheBytes: number; cookieCount: number }

export interface AppInfo {
  name: string
  version: string
  electron: string
  chromium: string
  node: string
  v8: string
  platform: string
  arch: string
  userDataPath: string
}

export interface OverlayRequest {
  kind: 'adblock' | 'site-info' | 'extensions' | 'downloads' | 'profiles' | 'menu' | 'suggestions' | 'bookmark-edit' | 'prompt' | 'group-edit' | 'zoom' | 'find' | 'tab-menu'
  anchor: { x: number; y: number; width: number; height: number }
  align?: 'left' | 'right'
  width: number
  height: number
  focus?: boolean
  props?: Record<string, unknown>
}
