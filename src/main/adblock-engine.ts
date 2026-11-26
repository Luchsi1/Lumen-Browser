// Filtering engine wrapper around @ghostery/adblocker (uBlock Origin / ABP compatible syntax).
// No Electron imports, so it can be unit tested in plain Node.
import fs from 'node:fs'
import path from 'node:path'
import { FiltersEngine, Request, parseFilters } from '@ghostery/adblocker'

export interface EngineInput { id: string; text: string }
export interface MatchResult { blocked: boolean; redirectUrl?: string; filter?: string; exception?: boolean }
export interface CosmeticResult { active: boolean; styles: string; scripts: string[] }
export interface BuildStats { networkRules: number; cosmeticRules: number; totalRules: number; customErrors: string[]; ms: number }

const CONFIG = { loadCosmeticFilters: true, loadNetworkFilters: true, loadGenericCosmeticsFilters: true, loadExtendedSelectors: false, enableHtmlFiltering: false } as const
const CACHE_VERSION = 'v1'

/** Estimate rule count for a raw list: non-empty lines that are not comments or headers. */
export function countRuleLines(text: string): number {
  let n = 0
  let start = 0
  const len = text.length
  while (start < len) {
    let end = text.indexOf('\n', start)
    if (end === -1) end = len
    const c = text.charCodeAt(start)
    // '!' = comment, '[' = header, '#' alone followed by space = comment. Allow '##' cosmetic and '#@#'.
    if (end > start && c !== 33 && c !== 91 && c !== 13 && !(c === 35 && text.charCodeAt(start + 1) === 32)) n++
    start = end + 1
  }
  return n
}

export class FilterEngineManager {
  private ads: FiltersEngine = FiltersEngine.empty(CONFIG as any)
  private security: FiltersEngine = FiltersEngine.empty(CONFIG as any)
  ready = false
  stats: BuildStats = { networkRules: 0, cosmeticRules: 0, totalRules: 0, customErrors: [], ms: 0 }

  private cacheDir?: string
  private resourcesText = ''
  private resourcesSum = ''
  /** Number of scriptlets/redirect resources currently loaded (0 means `##+js()` rules do nothing). */
  resourceCount = 0

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir
    if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true })
  }

  /** Compile lists. `main` feed the request/cosmetic engine, `security` feed the top-level navigation engine. */
  build(main: EngineInput[], security: EngineInput[], customRules: string, cacheKey?: string): BuildStats {
    const t0 = Date.now()
    const customErrors: string[] = []
    if (customRules.trim()) {
      const parsed = parseFilters(customRules, CONFIG as any)
      for (const f of parsed.notSupportedFilters) customErrors.push(`${f.filter}`)
    }
    const key = cacheKey ? `${CACHE_VERSION}-${cacheKey}` : undefined
    const cachedAds = key && this.readCache('ads', key)
    const cachedSec = key && this.readCache('security', key)

    this.ads = cachedAds ? this.safeDeserialize(cachedAds) ?? this.compile(main, customRules) : this.compile(main, customRules)
    this.security = cachedSec ? this.safeDeserialize(cachedSec) ?? this.compile(security, '') : this.compile(security, '')
    if (key) {
      if (!cachedAds) this.writeCache('ads', key, this.ads)
      if (!cachedSec) this.writeCache('security', key, this.security)
    }
    this.applyResources()
    const a = this.ads.getFilters()
    const s = this.security.getFilters()
    this.stats = {
      networkRules: a.networkFilters.length + s.networkFilters.length,
      cosmeticRules: a.cosmeticFilters.length,
      totalRules: a.networkFilters.length + a.cosmeticFilters.length + s.networkFilters.length + s.cosmeticFilters.length,
      customErrors,
      ms: Date.now() - t0,
    }
    this.ready = true
    return this.stats
  }

  /** uBlock Origin resources.json: scriptlets (`##+js(...)`) and redirect resources. Applies immediately. */
  setResources(text: string) {
    let count = 0
    try {
      const d = JSON.parse(text)
      count = (Array.isArray(d.scriptlets) ? d.scriptlets.length : 0) + (Array.isArray(d.redirects) ? d.redirects.length : 0)
    } catch { throw new Error('resources file is not valid JSON') }
    this.resourcesText = text
    this.resourcesSum = `${text.length}:${text.slice(0, 64)}:${text.slice(-64)}`
    this.resourceCount = count
    this.applyResources()
  }

  private applyResources() {
    if (!this.resourcesText) return
    try { this.ads.updateResources(this.resourcesText, this.resourcesSum) } catch { /* keep running without scriptlets */ }
  }

  private compile(inputs: EngineInput[], extra: string): FiltersEngine {
    const text = inputs.map((i) => i.text).join('\n') + '\n' + extra
    return FiltersEngine.parse(text, CONFIG as any)
  }

  private safeDeserialize(buf: Uint8Array): FiltersEngine | null {
    try { return FiltersEngine.deserialize(buf) } catch { return null }
  }

  private cacheFile(name: string) { return path.join(this.cacheDir!, `engine-${name}.bin`) }
  private keyFile(name: string) { return path.join(this.cacheDir!, `engine-${name}.key`) }

  private readCache(name: string, key: string): Uint8Array | null {
    if (!this.cacheDir) return null
    try {
      if (fs.readFileSync(this.keyFile(name), 'utf8') !== key) return null
      return new Uint8Array(fs.readFileSync(this.cacheFile(name)))
    } catch { return null }
  }

  private writeCache(name: string, key: string, engine: FiltersEngine) {
    if (!this.cacheDir) return
    try {
      const tmp = this.cacheFile(name) + '.tmp'
      fs.writeFileSync(tmp, engine.serialize())
      fs.renameSync(tmp, this.cacheFile(name))
      fs.writeFileSync(this.keyFile(name), key)
    } catch (e) { console.error('[adblock] cache write failed', e) }
  }

  makeRequest(url: string, sourceUrl: string, type: string): Request {
    return Request.fromRawDetails({ url, sourceUrl, type: type as any })
  }

  /** Match a subresource or navigation against the main (ads/privacy/custom) engine. */
  match(url: string, sourceUrl: string, type: string): MatchResult {
    if (!this.ready) return { blocked: false }
    const req = this.makeRequest(url, sourceUrl, type)
    const { match, redirect, exception, filter } = this.ads.match(req)
    if (redirect) return { blocked: true, redirectUrl: redirect.dataUrl, filter: filter?.toString() }
    if (match) return { blocked: true, filter: filter?.toString() }
    return { blocked: false, exception: !!exception }
  }

  /** Match a top-level navigation against the security (badware, malware) engine. */
  matchSecurity(url: string, sourceUrl = ''): MatchResult {
    if (!this.ready) return { blocked: false }
    const req = this.makeRequest(url, sourceUrl, 'mainFrame')
    const { match, filter } = this.security.match(req)
    return match ? { blocked: true, filter: filter?.toString() } : { blocked: false }
  }

  /**
   * True when a domain/URL rule blocks the target of a popup. The engine does not implement the
   * `$popup` option, so a popup target is evaluated as a sub-frame request: plain `||domain^`
   * rules match, `$popup`-only rules do not.
   */
  matchPopup(url: string, sourceUrl: string): MatchResult {
    if (!this.ready) return { blocked: false }
    const req = this.makeRequest(url, sourceUrl, 'subFrame')
    const { match, filter } = this.ads.match(req)
    return match ? { blocked: true, filter: filter?.toString() } : { blocked: false }
  }

  cosmetics(url: string, hostname: string, domain: string, msg?: { classes?: string[]; hrefs?: string[]; ids?: string[]; lifecycle?: any }, caller?: any): CosmeticResult {
    if (!this.ready) return { active: false, styles: '', scripts: [] }
    const first = msg === undefined
    const r = this.ads.getCosmeticsFilters({
      url, hostname, domain,
      classes: msg?.classes, hrefs: msg?.hrefs, ids: msg?.ids,
      getBaseRules: first, getInjectionRules: first, getExtendedRules: false, getRulesFromHostname: first, getRulesFromDOM: !first,
      callerContext: caller,
    } as any)
    return { active: r.active !== false, styles: r.styles, scripts: r.scripts }
  }

  cspFor(url: string, sourceUrl: string, type: 'mainFrame' | 'subFrame'): string | undefined {
    if (!this.ready) return undefined
    return this.ads.getCSPDirectives(this.makeRequest(url, sourceUrl, type))
  }
}
