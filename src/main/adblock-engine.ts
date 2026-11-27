// Filtering engine wrapper around @ghostery/adblocker (uBlock Origin / ABP compatible syntax).
// No Electron imports, so it can be unit tested in plain Node.
//
// Memory notes (this file is the largest single consumer in the main process):
//  - A cached start never reads the list files: the engine is deserialized straight from the cache file without copying it.
//  - Parsing lists is memory hungry and the allocator keeps that memory afterwards (measured: ~200 MB stays in the process
//    that parsed, also when that was a worker thread). A fresh compile therefore runs in a separate process (see
//    adblock-worker.ts) and only the compact serialized engine comes back.
//  - Rule counts are stored next to the cache. Asking a loaded engine for them (`getFilters()`) would rebuild every
//    rule as a JS object (~70 MB for a 250k rule set).
//  - The uBlock resources file (scriptlets) is re-read from disk when needed instead of being kept as a string.
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { FiltersEngine, Request, parseFilters } from '@ghostery/adblocker'
import { ADS_CONFIG, compileJob, type CompileJob, type CompileResult, type EngineInput, type RuleCounts } from './adblock-compile.ts'

export type { EngineInput } from './adblock-compile.ts'
export interface MatchResult { blocked: boolean; redirectUrl?: string; filter?: string; exception?: boolean }
export interface CosmeticResult { active: boolean; styles: string; scripts: string[] }
export interface BuildStats { networkRules: number; cosmeticRules: number; totalRules: number; customErrors: string[]; ms: number }

/** Bumped whenever the engine configuration or the on-disk cache layout changes. */
const CACHE_VERSION = 'v2'

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

interface Loaded { engine: FiltersEngine; counts: RuleCounts }

/** Compiles a job somewhere else than the calling code (another process or thread). */
export type Compiler = (job: CompileJob) => Promise<CompileResult>

/** Compile in a worker thread. `source` is the bundled compiler script, run as eval code so it also works from inside an asar archive. */
export function threadCompiler(source: string): Compiler {
  return (job) => new Promise((resolve, reject) => {
    const w = new Worker(source, { eval: true, workerData: job })
    let settled = false
    w.once('message', (m: { ok: boolean; result?: CompileResult; error?: string }) => {
      settled = true
      void w.terminate()
      if (m.ok && m.result) resolve(m.result); else reject(new Error(m.error ?? 'filter compiler failed'))
    })
    w.once('error', (e) => { if (!settled) { settled = true; reject(e) } })
    w.once('exit', (code) => { if (!settled) { settled = true; reject(new Error(`filter compiler exited with code ${code}`)) } })
  })
}

export class FilterEngineManager {
  private ads: FiltersEngine = FiltersEngine.empty(ADS_CONFIG as any)
  private security: FiltersEngine = FiltersEngine.empty(ADS_CONFIG as any)
  ready = false
  stats: BuildStats = { networkRules: 0, cosmeticRules: 0, totalRules: 0, customErrors: [], ms: 0 }

  private cacheDir?: string
  /** Only kept when the resources were not given as a file (tests); otherwise they are re-read from `resourcesFile`. */
  private resourcesText = ''
  private resourcesFile = ''
  private resourcesSum = ''
  /** Number of scriptlets/redirect resources currently loaded (0 means `##+js()` rules do nothing). */
  resourceCount = 0

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir
    if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true })
  }

  // ------------------------------------------------------------------ building
  /** Compile lists synchronously in this thread. `main` feed the request/cosmetic engine, `security` feed the top-level navigation engine. */
  build(main: EngineInput[], security: EngineInput[], customRules: string, cacheKey?: string): BuildStats {
    const t0 = Date.now()
    const key = this.keyFor(cacheKey)
    const cAds = key ? this.readCache('ads', key) : null
    const cSec = key ? this.readCache('security', key) : null
    let result: CompileResult | null = null
    if (!cAds || !cSec) result = compileJob({ main, security, customRules, needAds: !cAds, needSecurity: !cSec })
    return this.install(key, cAds, cSec, result, customRules, t0)
  }

  /**
   * Same as build(), but a fresh compile is handed to `compile` (another process or thread), which keeps the main thread
   * responsive and the parser's memory out of this process. The previous engine stays active until the new one is ready.
   * Falls back to compiling in this thread if `compile` is missing or fails.
   */
  async buildAsync(main: EngineInput[], security: EngineInput[], customRules: string, cacheKey?: string, compile?: Compiler): Promise<BuildStats> {
    const t0 = Date.now()
    const key = this.keyFor(cacheKey)
    const cAds = key ? this.readCache('ads', key) : null
    const cSec = key ? this.readCache('security', key) : null
    let result: CompileResult | null = null
    if (!cAds || !cSec) {
      const job: CompileJob = { main, security, customRules, needAds: !cAds, needSecurity: !cSec }
      try {
        result = compile ? await compile(job) : compileJob(job)
      } catch (e) {
        console.warn('[adblock] external compile failed, compiling in the main thread:', (e as Error)?.message ?? e)
        result = compileJob(job)
      }
    }
    return this.install(key, cAds, cSec, result, customRules, t0)
  }

  private keyFor(cacheKey?: string) { return cacheKey ? `${CACHE_VERSION}-${cacheKey}` : undefined }

  private install(key: string | undefined, cAds: Loaded | null, cSec: Loaded | null, r: CompileResult | null, customRules: string, t0: number): BuildStats {
    const customErrors: string[] = []
    if (customRules.trim()) {
      const parsed = parseFilters(customRules, ADS_CONFIG as any)
      for (const f of parsed.notSupportedFilters) customErrors.push(`${f.filter}`)
    }
    const ads = cAds ?? this.fromCompiled('ads', key, r!.ads!, r!.adsCounts!)
    const sec = cSec ?? this.fromCompiled('security', key, r!.security!, r!.securityCounts!)
    this.ads = ads.engine
    this.security = sec.engine
    this.applyResources()
    this.stats = {
      networkRules: ads.counts.network + sec.counts.network,
      cosmeticRules: ads.counts.cosmetic,
      totalRules: ads.counts.network + ads.counts.cosmetic + sec.counts.network + sec.counts.cosmetic,
      customErrors,
      ms: Date.now() - t0,
    }
    this.ready = true
    return this.stats
  }

  /** Store a freshly compiled engine in the cache and load it the same way a cached one is loaded. */
  private fromCompiled(name: string, key: string | undefined, bytes: Uint8Array, counts: RuleCounts): Loaded {
    if (key) this.writeCache(name, key, bytes, counts)
    return { engine: FiltersEngine.deserialize(bytes), counts }
  }

  // ------------------------------------------------------------------ uBlock resources
  /** uBlock Origin resources.json: scriptlets (`##+js(...)`) and redirect resources. Applies immediately. Throws on invalid JSON. */
  setResources(text: string, persistedFile?: string) {
    let count = 0
    try {
      const d = JSON.parse(text)
      count = (Array.isArray(d.scriptlets) ? d.scriptlets.length : 0) + (Array.isArray(d.redirects) ? d.redirects.length : 0)
    } catch { throw new Error('resources file is not valid JSON') }
    this.resourcesFile = persistedFile ?? ''
    // With a file on disk the (multi-MB) string is not kept.
    this.resourcesText = persistedFile ? '' : text
    this.resourcesSum = `${text.length}:${text.slice(0, 64)}:${text.slice(-64)}`
    this.resourceCount = count
    this.applyText(text)
  }

  setResourcesFromFile(file: string) { this.setResources(fs.readFileSync(file, 'utf8'), file) }

  private applyText(text: string) {
    try { this.ads.updateResources(text, this.resourcesSum) } catch { /* keep running without scriptlets */ }
  }

  private applyResources() {
    if (this.resourcesText) return this.applyText(this.resourcesText)
    if (!this.resourcesFile) return
    try { this.applyText(fs.readFileSync(this.resourcesFile, 'utf8')) } catch { /* file vanished: scriptlets stay inactive */ }
  }

  // ------------------------------------------------------------------ cache
  private cacheFile(name: string) { return path.join(this.cacheDir!, `engine-${name}.bin`) }
  private keyFile(name: string) { return path.join(this.cacheDir!, `engine-${name}.key`) }
  private countsFile(name: string) { return path.join(this.cacheDir!, `engine-${name}.counts.json`) }

  private readCache(name: string, key: string): Loaded | null {
    if (!this.cacheDir) return null
    try {
      if (fs.readFileSync(this.keyFile(name), 'utf8') !== key) return null
      const counts = JSON.parse(fs.readFileSync(this.countsFile(name), 'utf8')) as RuleCounts
      if (typeof counts.network !== 'number' || typeof counts.cosmetic !== 'number') return null
      const buf = fs.readFileSync(this.cacheFile(name))
      // A view on the file buffer, not a copy: the engine keeps referring to it, so a copy would double the memory.
      return { engine: FiltersEngine.deserialize(new Uint8Array(buf.buffer, buf.byteOffset, buf.length)), counts }
    } catch { return null }
  }

  private writeCache(name: string, key: string, bytes: Uint8Array, counts: RuleCounts) {
    if (!this.cacheDir) return
    try {
      // The key goes last: an interrupted write leaves a stale key, which simply means "no valid cache".
      try { fs.unlinkSync(this.keyFile(name)) } catch { /* none yet */ }
      const tmp = this.cacheFile(name) + '.tmp'
      fs.writeFileSync(tmp, bytes)
      fs.renameSync(tmp, this.cacheFile(name))
      fs.writeFileSync(this.countsFile(name), JSON.stringify(counts))
      fs.writeFileSync(this.keyFile(name), key)
    } catch (e) { console.error('[adblock] cache write failed', e) }
  }

  // ------------------------------------------------------------------ matching
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

