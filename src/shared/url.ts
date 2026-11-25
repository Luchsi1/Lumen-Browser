// Pure URL helpers shared by main process, renderer and tests. No Electron imports here.

export const SEARCH_ENGINES: Record<string, { name: string; url: string; suggest?: string }> = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s', suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', suggest: 'https://duckduckgo.com/ac/?type=list&q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s', suggest: 'https://api.bing.com/osjson.aspx?query=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s', suggest: 'https://search.brave.com/api/suggest?q=%s' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s' },
}

const INTERNAL_HOSTS = ['settings', 'history', 'bookmarks', 'downloads', 'extensions', 'adblock', 'newtab', 'about', 'passwords', 'blocked', 'error']

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}(:\d{1,5})?(\/.*)?$/
const IPV6 = /^\[[0-9a-f:]+\](:\d{1,5})?(\/.*)?$/i
const HOSTNAME = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(:\d{1,5})?([/?#].*)?$/i
const LOCALHOST = /^(localhost|[a-z0-9-]+\.localhost)(:\d{1,5})?([/?#].*)?$/i
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function isLocalOrPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '::1') return true
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || a === 0
  }
  return !h.includes('.')
}

export function searchUrl(engineTemplate: string, query: string): string {
  return engineTemplate.replace('%s', encodeURIComponent(query))
}

/** Result of interpreting text typed into the address bar. */
export type Resolved = { kind: 'url' | 'search'; url: string }

/**
 * Decide whether the omnibox input is a URL or a search query.
 * `searchTemplate` must contain %s.
 */
export function resolveInput(raw: string, searchTemplate: string): Resolved {
  const input = raw.trim()
  if (!input) return { kind: 'url', url: 'lumen://newtab' }

  if (/^lumen:\/\//i.test(input)) return { kind: 'url', url: input }
  if (/^(about|chrome):/i.test(input)) {
    const host = input.replace(/^(about|chrome):(\/\/)?/i, '').split(/[/?#]/)[0].toLowerCase()
    if (INTERNAL_HOSTS.includes(host)) return { kind: 'url', url: `lumen://${host}` }
  }
  if (/^(https?|file|ftp|chrome-extension|view-source|data|blob):/i.test(input) && !/\s/.test(input)) {
    return { kind: 'url', url: input }
  }
  // "host:port" looks like a scheme to the SCHEME regexp, so test it before the generic scheme check.
  if (LOCALHOST.test(input) || IPV4.test(input) || IPV6.test(input)) {
    if (!/\s/.test(input)) return { kind: 'url', url: `http://${input}` }
  }
  if (SCHEME.test(input) && !/^[^:\s]+:\d+/.test(input) && !/\s/.test(input) && /^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    return { kind: 'url', url: input }
  }
  if (!/\s/.test(input) && HOSTNAME.test(input)) {
    return { kind: 'url', url: `https://${input}` }
  }
  return { kind: 'search', url: searchUrl(searchTemplate, input) }
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname } catch { return '' }
}

export function originOf(url: string): string {
  try {
    const u = new URL(url)
    return u.origin === 'null' ? `${u.protocol}//${u.host}` : u.origin
  } catch { return '' }
}

export function isInternalUrl(url: string): boolean {
  return url.startsWith('lumen://')
}

export function displayUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('lumen://newtab')) return ''
  try {
    const u = new URL(url)
    if (u.protocol === 'lumen:') return `lumen://${u.host}${u.pathname === '/' ? '' : u.pathname}`
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const path = u.pathname === '/' && !u.search && !u.hash ? '' : u.pathname + u.search + u.hash
      return u.host + path
    }
  } catch { /* fallthrough */ }
  return url
}

/** True if hostname equals domain or is a subdomain of it. */
export function hostMatches(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase()
  const d = domain.toLowerCase().replace(/^\*\./, '')
  return h === d || h.endsWith('.' + d)
}

export function normalizeAllowEntry(entry: string): string {
  let e = entry.trim().toLowerCase()
  if (!e) return ''
  try { if (e.includes('://')) e = new URL(e).hostname } catch { /* keep */ }
  return e.replace(/^www\./, '').replace(/\/.*$/, '')
}
