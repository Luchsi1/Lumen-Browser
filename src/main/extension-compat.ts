// Static compatibility analysis for Chrome extensions. Pure functions, no Electron imports.
//
// IMPORTANT: this is based on the documented behaviour of Electron 45 and electron-chrome-extensions 4.x,
// not on running every extension. "full" means "no known gap", never "verified to work".
import type { CompatIssue, CompatLevel } from '../shared/types.ts'

export type ApiSupport = { status: 'supported' | 'partial' | 'unsupported'; note?: string }

/** chrome.* namespaces and what this browser provides. Namespaces missing here are reported as "not verified". */
export const API_SUPPORT: Record<string, ApiSupport> = {
  runtime: { status: 'supported' },
  storage: { status: 'supported', note: 'storage.sync is stored locally and does not sync between devices; storage.managed is always empty.' },
  tabs: { status: 'partial', note: 'tabs.duplicate, move, highlight, captureVisibleTab, detectLanguage and discard are not implemented; tabs.query and tabs.update support only some properties.' },
  windows: { status: 'supported' },
  scripting: { status: 'supported' },
  contextMenus: { status: 'partial', note: 'contextMenus.update is not implemented.' },
  menus: { status: 'unsupported', note: 'chrome.menus is a Firefox API.' },
  cookies: { status: 'supported' },
  notifications: { status: 'partial', note: 'Notification button clicks are not delivered.' },
  action: { status: 'partial', note: 'action.enable and action.disable are not implemented.' },
  browserAction: { status: 'partial', note: 'Manifest V2 browser actions only; enable/disable not implemented.' },
  pageAction: { status: 'unsupported', note: 'Page actions are not shown.' },
  webNavigation: { status: 'partial', note: 'onErrorOccurred and onReferenceFragmentUpdated are not emitted; onDOMContentLoaded only for the top frame.' },
  webRequest: { status: 'partial', note: "Lumen's built-in request filter owns Electron's webRequest hooks, so extension webRequest listeners are never called. Extensions that block or modify network requests will not work." },
  declarativeNetRequest: { status: 'unsupported', note: 'Not implemented by Electron. Content blockers built on declarativeNetRequest (uBlock Origin Lite, AdGuard MV3) will install but block nothing. Use the built-in ad blocker instead.' },
  declarativeNetRequestFeedback: { status: 'unsupported', note: 'Depends on declarativeNetRequest, which is not implemented.' },
  declarativeContent: { status: 'unsupported' },
  commands: { status: 'unsupported', note: 'Extension keyboard shortcuts are not implemented.' },
  bookmarks: { status: 'unsupported', note: "Extensions cannot read or change Lumen's bookmarks." },
  history: { status: 'unsupported', note: "Extensions cannot read or change Lumen's history." },
  downloads: { status: 'unsupported', note: "Extensions cannot start or observe downloads." },
  tabGroups: { status: 'unsupported' },
  sessions: { status: 'unsupported' },
  topSites: { status: 'unsupported' },
  identity: { status: 'unsupported', note: 'chrome.identity (Google sign-in for extensions) is not implemented.' },
  proxy: { status: 'unsupported' },
  privacy: { status: 'unsupported' },
  offscreen: { status: 'unsupported', note: 'Offscreen documents are not implemented, so Manifest V3 extensions that rely on them will not fully work.' },
  sidePanel: { status: 'unsupported', note: 'Use of the extension side panel is not implemented.' },
  omnibox: { status: 'unsupported' },
  search: { status: 'unsupported' },
  tts: { status: 'unsupported' },
  ttsEngine: { status: 'unsupported' },
  management: { status: 'partial', note: 'Only getAll, get, getSelf and permission warning queries.' },
  extension: { status: 'partial', note: 'Only getURL, getBackgroundPage and lastError.' },
  devtools: { status: 'supported' },
  i18n: { status: 'supported' },
  system: { status: 'partial', note: 'Only chrome.system.storage.' },
  alarms: { status: 'partial', note: 'Provided by the Chromium runtime; not verified in Lumen.' },
  permissions: { status: 'partial', note: 'Optional permission requests are routed to the browser, but no permission can be revoked afterwards.' },
  idle: { status: 'partial', note: 'Not verified in Lumen.' },
  webAuthenticationProxy: { status: 'unsupported' },
  nativeMessaging: { status: 'unsupported', note: 'Native messaging hosts are not supported.' },
  desktopCapture: { status: 'unsupported' },
  tabCapture: { status: 'unsupported' },
  pageCapture: { status: 'unsupported' },
  printing: { status: 'unsupported' },
  fontSettings: { status: 'unsupported' },
  contentSettings: { status: 'unsupported' },
  browsingData: { status: 'unsupported' },
  readingList: { status: 'unsupported' },
  geolocation: { status: 'partial' },
  declarativeWebRequest: { status: 'unsupported' },
}

/** Permission strings in the manifest that name a chrome.* namespace. */
const PERMISSION_TO_API: Record<string, string> = {
  activeTab: 'tabs', tabs: 'tabs', scripting: 'scripting', storage: 'storage', unlimitedStorage: 'storage', contextMenus: 'contextMenus', cookies: 'cookies',
  notifications: 'notifications', webNavigation: 'webNavigation', webRequest: 'webRequest', webRequestBlocking: 'webRequest', webRequestAuthProvider: 'webRequest',
  declarativeNetRequest: 'declarativeNetRequest', declarativeNetRequestWithHostAccess: 'declarativeNetRequest', declarativeNetRequestFeedback: 'declarativeNetRequestFeedback',
  declarativeContent: 'declarativeContent', bookmarks: 'bookmarks', history: 'history', downloads: 'downloads', tabGroups: 'tabGroups', sessions: 'sessions', topSites: 'topSites',
  identity: 'identity', proxy: 'proxy', privacy: 'privacy', offscreen: 'offscreen', sidePanel: 'sidePanel', search: 'search', tts: 'tts', ttsEngine: 'ttsEngine', management: 'management',
  alarms: 'alarms', idle: 'idle', nativeMessaging: 'nativeMessaging', desktopCapture: 'desktopCapture', tabCapture: 'tabCapture', pageCapture: 'pageCapture', printing: 'printing',
  fontSettings: 'fontSettings', contentSettings: 'contentSettings', browsingData: 'browsingData', readingList: 'readingList', system: 'system', commands: 'commands',
}

export interface CompatInput {
  manifest: any
  /** Source text of JavaScript files found in the extension (path -> text). Optional; improves detection. */
  scripts?: Record<string, string>
}
export interface CompatReport { level: CompatLevel; issues: CompatIssue[]; apisUsed: string[] }

/** Find `chrome.<namespace>` references in script text. */
export function scanApiUsage(text: string): Set<string> {
  const found = new Set<string>()
  const re = /\b(?:chrome|browser)\s*\.\s*([a-zA-Z]+)\s*[.[]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) found.add(m[1])
  return found
}

export function analyzeManifest({ manifest, scripts }: CompatInput): CompatReport {
  const issues: CompatIssue[] = []
  const used = new Set<string>()
  const mv = manifest?.manifest_version

  if (mv !== 2 && mv !== 3) {
    issues.push({ level: 'error', message: `Unsupported manifest_version ${JSON.stringify(mv)}. Only Manifest V2 and V3 exist.` })
    return { level: 'unsupported', issues, apisUsed: [] }
  }
  if (!manifest.name || !manifest.version) issues.push({ level: 'error', message: 'The manifest is missing "name" or "version".' })

  if (mv === 2) {
    issues.push({ level: 'warning', message: "Manifest V2. Current Chromium releases are phasing out Manifest V2 and Electron's extension loader may refuse or only partly run it. If it loads, it is reported as such; if it fails, the load error is shown here." })
  }

  const perms: string[] = [...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])].filter((p: unknown) => typeof p === 'string')
  for (const p of perms) { const api = PERMISSION_TO_API[p]; if (api) used.add(api) }
  if (manifest.action) used.add('action')
  if (manifest.browser_action) used.add('browserAction')
  if (manifest.page_action) used.add('pageAction')
  if (manifest.commands) used.add('commands')
  if (manifest.omnibox) used.add('omnibox')
  if (manifest.side_panel) used.add('sidePanel')
  if (manifest.declarative_net_request) used.add('declarativeNetRequest')
  if (manifest.chrome_url_overrides) {
    const k = Object.keys(manifest.chrome_url_overrides)
    if (k.some((x) => x !== 'newtab')) issues.push({ level: 'warning', message: `chrome_url_overrides for ${k.filter((x) => x !== 'newtab').join(', ')} is not supported. Only a new-tab override is honoured.` })
  }
  if (scripts) for (const text of Object.values(scripts)) for (const ns of scanApiUsage(text)) if (ns in API_SUPPORT) used.add(ns)

  const apisUsed = [...used].sort()
  let blocking = false
  let partial = false
  for (const api of apisUsed) {
    const s = API_SUPPORT[api]
    if (!s) continue
    if (s.status === 'unsupported') {
      // An API that is only requested but never used in code is a smaller problem; still reported.
      issues.push({ level: 'error', message: `chrome.${api}: ${s.note ?? 'not implemented in this browser.'}` })
      blocking = true
    } else if (s.status === 'partial' && s.note) {
      issues.push({ level: 'warning', message: `chrome.${api}: ${s.note}` })
      partial = true
    }
  }
  for (const api of apisUsed) if (!API_SUPPORT[api]) issues.push({ level: 'info', message: `chrome.${api}: support has not been verified.` })

  if (mv === 3 && manifest.background?.service_worker) {
    issues.push({ level: 'info', message: 'Uses a Manifest V3 service worker. Electron keeps these workers alive; they are not suspended when idle as in Chrome.' })
  }
  if (manifest.incognito === 'split') issues.push({ level: 'info', message: 'Extensions never run in private windows in Lumen.' })
  if (manifest.content_security_policy && mv === 2 && /unsafe-eval/.test(String(manifest.content_security_policy))) {
    issues.push({ level: 'info', message: 'Relaxed content security policy (unsafe-eval).' })
  }

  const hasError = issues.some((i) => i.level === 'error')
  let level: CompatLevel
  if (!manifest.name || !manifest.version) level = 'unsupported'
  else if (blocking && (apisUsed.includes('declarativeNetRequest') || apisUsed.includes('webRequest') && perms.includes('webRequestBlocking'))) level = 'limited'
  else if (hasError) level = 'limited'
  else if (partial || mv === 2) level = 'partial'
  else level = 'full'
  return { level, issues, apisUsed }
}

/** Human readable permission descriptions, similar to Chrome's install prompt. */
export const PERMISSION_TEXT: Record<string, string> = {
  activeTab: 'Access the current tab when you click the extension',
  tabs: 'See the URL and title of your open tabs',
  storage: 'Store data locally',
  unlimitedStorage: 'Store an unlimited amount of data locally',
  cookies: 'Read and change cookies',
  webRequest: 'Observe network requests (not functional in Lumen)',
  webRequestBlocking: 'Block or modify network requests (not functional in Lumen)',
  declarativeNetRequest: 'Block content using rules (not functional in Lumen)',
  webNavigation: 'See your navigation activity',
  scripting: 'Inject scripts into pages',
  contextMenus: 'Add items to the right-click menu',
  notifications: 'Show notifications',
  history: 'Read your browsing history (not available in Lumen)',
  bookmarks: 'Read and change bookmarks (not available in Lumen)',
  downloads: 'Manage downloads (not available in Lumen)',
  management: 'Manage other extensions',
  clipboardRead: 'Read data you copy',
  clipboardWrite: 'Write to the clipboard',
  geolocation: 'Know your location',
  nativeMessaging: 'Talk to programs on your computer (not available in Lumen)',
  identity: 'Use your account identity (not available in Lumen)',
  alarms: 'Schedule background tasks',
  idle: 'Detect when you are idle',
  proxy: 'Control proxy settings (not available in Lumen)',
  privacy: 'Change privacy settings (not available in Lumen)',
}

export function describeHostAccess(hosts: string[]): string {
  if (hosts.some((h) => h === '<all_urls>' || h === '*://*/*' || h === 'http://*/*' || h === 'https://*/*')) return 'Read and change all your data on all websites'
  if (hosts.length === 0) return 'No website access'
  return `Read and change your data on ${hosts.length} site pattern${hosts.length === 1 ? '' : 's'}: ${hosts.slice(0, 5).join(', ')}${hosts.length > 5 ? ', ...' : ''}`
}
