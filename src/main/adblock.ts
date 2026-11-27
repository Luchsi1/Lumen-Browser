// Electron integration of the filter engine: list storage and updates, request hook, cosmetic filtering,
// per-tab statistics and per-site allowlist.
import { app, ipcMain, net, utilityProcess, type Session, type WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { parse as parseUrl } from 'tldts-experimental'
import { FilterEngineManager, countRuleLines, threadCompiler, type Compiler, type EngineInput } from './adblock-engine.ts'
import { JsonStore } from './store.ts'
import { hostMatches, normalizeAllowEntry } from '../shared/url.ts'
import type { AppData } from './data.ts'
import type { AdblockStatus, BlockedRequestInfo, FilterListConfig, FilterListStatus, SiteBlockStats } from '../shared/types.ts'

interface Meta { status: Record<string, { lastUpdated: number | null; ruleCount: number; error?: string }>; lastUpdate: number | null }

interface TabStats { host: string; count: number; recent: BlockedRequestInfo[]; byDomain: Record<string, number>; popups: number }

const RESOURCES_URL = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json'
const PRELOAD_CHANNEL_INJECT = '@ghostery/adblocker/inject-cosmetic-filters'
const PRELOAD_CHANNEL_MUT = '@ghostery/adblocker/is-mutation-observer-enabled'
const SECURITY_CATEGORY = 'security'
const MAX_RECENT = 300

export class AdblockService extends EventEmitter {
  engine: FilterEngineManager
  private meta: JsonStore<Meta>
  private listDir: string
  private tabs = new Map<number, TabStats>()
  private sessionBlocked = 0
  private updating = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private emitTimer: NodeJS.Timeout | null = null
  private customErrors: string[] = []
  private resourcesError: string | undefined
  private preloadPath: string | null = null
  private cosmeticHandlerInstalled = false

  constructor(private data: AppData) {
    super()
    const dir = path.join(data.dir, 'adblock')
    this.listDir = path.join(dir, 'lists')
    fs.mkdirSync(this.listDir, { recursive: true })
    this.engine = new FilterEngineManager(path.join(dir, 'cache'))
    this.meta = new JsonStore<Meta>({ dir, name: 'meta', defaults: { status: {}, lastUpdate: null } })
  }

  private get cfg() { return this.data.settings.data.adblock }
  private get settings() { return this.data.settings.data }

  // ------------------------------------------------------------------ lifecycle
  // Neutered stand-ins for blocked scripts (`$redirect=noopjs` and friends). Chromium refuses a redirect from a web page to a
  // data: URL, so the stub is served from lumen://resource/<id> instead.
  private stubs = new Map<string, { mime: string; body: Buffer }>()

  private resourceUrl(dataUrl: string): string | null {
    const mt = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl)
    if (!mt) return null
    const body = mt[2] ? Buffer.from(mt[3], 'base64') : Buffer.from(decodeURIComponent(mt[3]), 'utf8')
    const id = createHash('sha1').update(mt[1]).update(body).digest('hex').slice(0, 20)
    if (!this.stubs.has(id)) this.stubs.set(id, { mime: mt[1], body })
    return `lumen://resource/${id}`
  }

  getStub(id: string) { return this.stubs.get(id) ?? null }

  private resourcesFile() { return path.join(this.listDir, '_resources.json') }

  private loadResources(): boolean {
    try { this.engine.setResourcesFromFile(this.resourcesFile()); return true } catch { return false }
  }

  /** Scriptlet library for `##+js(...)` rules. Failure is not fatal: those rules are then inactive. */
  private async updateResources() {
    try {
      const res = await net.fetch(RESOURCES_URL, { signal: AbortSignal.timeout(90_000), headers: { 'User-Agent': 'Lumen-FilterUpdater' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      this.engine.setResources(text, this.resourcesFile()) // validates; the engine re-reads the file instead of keeping the text
      const tmp = this.resourcesFile() + '.tmp'
      fs.writeFileSync(tmp, text); fs.renameSync(tmp, this.resourcesFile())
      this.resourcesError = undefined
    } catch (e: any) { this.resourcesError = String(e?.message ?? e) }
  }

  /** Resolves when the first engine is ready (immediately from the cache, after a compile on a first run or after a list update). */
  async init() {
    this.seedFromBundle()
    this.loadResources()
    this.installCosmeticHandler()
    this.schedule()
    // Refresh stale lists shortly after start so startup is never blocked on the network.
    setTimeout(() => { if (this.isStale()) void this.updateAll(false) }, 8000)
    await this.rebuild()
  }

  private seedDir(): string {
    return app.isPackaged ? path.join(process.resourcesPath, 'filterlists') : path.join(app.getAppPath(), 'resources', 'filterlists')
  }

  /** Copy filter lists bundled with the installer so blocking works on the very first launch, offline. */
  private seedFromBundle() {
    const seed = this.seedDir()
    if (!fs.existsSync(seed)) return
    for (const l of this.cfg.lists) {
      const dst = this.listFile(l.id)
      const src = path.join(seed, `${l.id}.txt`)
      if (!fs.existsSync(dst) && fs.existsSync(src)) {
        try {
          fs.copyFileSync(src, dst)
          const text = fs.readFileSync(dst, 'utf8')
          this.meta.data.status[l.id] = { lastUpdated: fs.statSync(src).mtimeMs, ruleCount: countRuleLines(text) }
        } catch (e) { console.error('[adblock] seed failed', l.id, e) }
      }
    }
    const rs = path.join(seed, 'resources.json')
    if (!fs.existsSync(this.resourcesFile()) && fs.existsSync(rs)) { try { fs.copyFileSync(rs, this.resourcesFile()) } catch { /* optional */ } }
    this.meta.save()
  }

  private listFile(id: string) { return path.join(this.listDir, `${id.replace(/[^a-z0-9_-]/gi, '_')}.txt`) }

  private isStale(): boolean {
    if (!this.cfg.autoUpdate) return false
    const last = this.meta.data.lastUpdate
    return !last || Date.now() - last > this.cfg.updateIntervalHours * 3600_000
  }

  private schedule() {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => { if (this.isStale()) void this.updateAll(false) }, 30 * 60_000)
    this.timer.unref?.()
  }

  // ------------------------------------------------------------------ list management
  private activeLists(): FilterListConfig[] {
    const tracking = this.settings.trackingProtection
    return this.cfg.lists.filter((l) => l.enabled && (tracking || l.category !== 'privacy'))
  }

  private rebuilding: Promise<void> | null = null
  private rebuildAgain = false

  /** Where the bundled list compiler lives. Packaged builds unpack it from the asar archive so a separate process can run it. */
  private compilerScript(): string {
    const p = path.join(__dirname, 'adblock-worker.js')
    const unpacked = p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    return unpacked !== p && fs.existsSync(unpacked) ? unpacked : p
  }

  /**
   * Compile in a short-lived utility process: when it exits, all the memory the list parser needed is returned to the OS.
   * (The same work in this process or in a worker thread leaves roughly 200 MB resident for the rest of the session.)
   * If the process cannot be started or does not answer, a worker thread is used, and the engine falls back to compiling
   * in-process as a last resort, so ad blocking never depends on this optimisation.
   */
  private compile: Compiler = async (job) => {
    try { return await this.compileInProcess(job) } catch (e) {
      console.warn('[adblock] utility process compile failed, trying a worker thread:', (e as Error)?.message ?? e)
      return threadCompiler(fs.readFileSync(path.join(__dirname, 'adblock-worker.js'), 'utf8'))(job)
    }
  }

  private compileInProcess(job: Parameters<Compiler>[0]): ReturnType<Compiler> {
    return new Promise((resolve, reject) => {
      const child = utilityProcess.fork(this.compilerScript(), [], { serviceName: 'Lumen filter compiler', stdio: 'ignore' })
      let done = false
      const finish = (fn: () => void) => { if (done) return; done = true; clearTimeout(timer); try { child.kill() } catch { /* already gone */ }; fn() }
      const timer = setTimeout(() => finish(() => reject(new Error('timed out'))), 180_000)
      child.once('message', (m: { ok: boolean; result?: any; error?: string }) => finish(() => (m?.ok && m.result ? resolve(m.result) : reject(new Error(m?.error ?? 'compiler failed')))))
      child.once('exit', (code) => finish(() => reject(new Error(`compiler exited with code ${code}`))))
      child.once('spawn', () => child.postMessage(job))
    })
  }

  /** Rebuild the engines from the stored lists. Requests that arrive while a build runs are folded into one follow-up build. The old engine keeps serving until the new one is ready. */
  rebuild(): Promise<void> {
    if (this.rebuilding) { this.rebuildAgain = true; return this.rebuilding }
    this.rebuilding = (async () => {
      do { this.rebuildAgain = false; await this.rebuildOnce() } while (this.rebuildAgain)
    })().finally(() => { this.rebuilding = null })
    return this.rebuilding
  }

  private async rebuildOnce() {
    const main: EngineInput[] = []
    const sec: EngineInput[] = []
    const keyParts: string[] = [String(this.cfg.cosmetic), this.cfg.customRules]
    for (const l of this.activeLists()) {
      // Only the file's size and modification time identify its content here: the text itself is read only if a compile is needed.
      const file = this.listFile(l.id)
      let st: fs.Stats
      try { st = fs.statSync(file) } catch { continue }
      ;(l.category === SECURITY_CATEGORY ? sec : main).push({ id: l.id, file })
      keyParts.push(`${l.id}:${this.meta.data.status[l.id]?.lastUpdated ?? 0}:${st.size}:${Math.round(st.mtimeMs)}`)
    }
    const key = createHash('sha1').update(keyParts.join('|')).digest('hex')
    try {
      const stats = await this.engine.buildAsync(main, sec, this.cfg.customRules, key, this.compile)
      this.customErrors = stats.customErrors
      console.log(`[adblock] ${stats.totalRules} rules ready in ${stats.ms}ms`)
    } catch (e) { console.error('[adblock] rebuild failed', e) }
    this.emitChanged()
  }

  async updateList(l: FilterListConfig): Promise<void> {
    if (this.updating.has(l.id)) return
    this.updating.add(l.id)
    this.emitChanged()
    try {
      if (!/^https?:\/\//i.test(l.url)) throw new Error('Only http(s) list URLs are supported')
      const res = await net.fetch(l.url, { signal: AbortSignal.timeout(90_000), headers: { 'User-Agent': 'Lumen-FilterUpdater' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (text.length < 20) throw new Error('List is empty')
      if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('Server returned a web page instead of a filter list')
      const tmp = this.listFile(l.id) + '.tmp'
      fs.writeFileSync(tmp, text)
      fs.renameSync(tmp, this.listFile(l.id))
      this.meta.data.status[l.id] = { lastUpdated: Date.now(), ruleCount: countRuleLines(text) }
    } catch (e: any) {
      const prev = this.meta.data.status[l.id] ?? { lastUpdated: null, ruleCount: 0 }
      // Keep the previous successful copy and timestamp; only record the error.
      this.meta.data.status[l.id] = { ...prev, error: String(e?.message ?? e) }
    } finally {
      this.updating.delete(l.id)
      this.meta.save()
    }
  }

  /** Download all enabled lists (or just one) and rebuild. `force` ignores nothing today but marks manual intent. */
  async updateAll(_force: boolean, onlyId?: string): Promise<void> {
    const targets = this.cfg.lists.filter((l) => (onlyId ? l.id === onlyId : l.enabled))
    await Promise.all([...targets.map((l) => this.updateList(l)), this.updateResources()])
    if (targets.some((l) => !this.meta.data.status[l.id]?.error)) this.meta.data.lastUpdate = Date.now()
    this.meta.flush()
    await this.rebuild()
  }

  async addList(name: string, url: string): Promise<FilterListConfig> {
    if (!/^https?:\/\//i.test(url)) throw new Error('The list URL must start with http:// or https://')
    if (this.cfg.lists.some((l) => l.url === url)) throw new Error('This list has already been added')
    const l: FilterListConfig = { id: 'custom-' + createHash('sha1').update(url).digest('hex').slice(0, 10), name: name.trim() || url, url, enabled: true, builtin: false, category: 'custom' }
    this.cfg.lists.push(l)
    this.data.settings.save()
    await this.updateAll(true, l.id)
    const err = this.meta.data.status[l.id]?.error
    if (err) {
      // A list that cannot be fetched at all is not kept, so the user gets a clear failure instead of a dead entry.
      this.cfg.lists = this.cfg.lists.filter((x) => x.id !== l.id)
      delete this.meta.data.status[l.id]
      this.data.settings.save(); this.meta.save()
      this.emitChanged()
      throw new Error(`Could not download the list: ${err}`)
    }
    return l
  }

  removeList(id: string) {
    const l = this.cfg.lists.find((x) => x.id === id)
    if (!l || l.builtin) return
    this.cfg.lists = this.cfg.lists.filter((x) => x.id !== id)
    delete this.meta.data.status[id]
    try { fs.unlinkSync(this.listFile(id)) } catch { /* already gone */ }
    this.data.settings.save(); this.meta.save()
    void this.rebuild()
  }

  async setListEnabled(id: string, enabled: boolean) {
    const l = this.cfg.lists.find((x) => x.id === id)
    if (!l) return
    l.enabled = enabled
    this.data.settings.save()
    if (enabled && !fs.existsSync(this.listFile(id))) await this.updateAll(true, id)
    else await this.rebuild()
  }

  reconfigure() { void this.rebuild(); this.schedule() }

  // ------------------------------------------------------------------ allowlist
  isAllowlisted(host: string): boolean {
    return this.cfg.allowlist.some((d) => hostMatches(host, d))
  }

  setSiteEnabled(host: string, enabled: boolean) {
    const entry = normalizeAllowEntry(host)
    if (!entry) return
    const list = this.cfg.allowlist
    if (enabled) this.cfg.allowlist = list.filter((d) => !hostMatches(host, d) && d !== entry)
    else if (!list.includes(entry)) list.push(entry)
    this.data.settings.save()
  }

  private active(): boolean { return this.cfg.enabled && this.engine.ready }

  // ------------------------------------------------------------------ request handling
  /** Called from the session's onBeforeRequest hook. Returns a response, or null to continue. */
  handleRequest(details: Electron.OnBeforeRequestListenerDetails): Electron.CallbackResponse | null {
    if (!this.active()) return null
    const url = details.url
    if (!/^(https?|wss?):/i.test(url)) return null
    const wc = details.webContents
    const topUrl = wc && !wc.isDestroyed() ? wc.getURL() : details.referrer
    const topHost = safeHost(topUrl)

    if (details.resourceType === 'mainFrame') {
      // Malicious-domain protection applies to top-level navigations only, and respects the allowlist.
      const host = safeHost(url)
      if (host && !this.isAllowlisted(host)) {
        const m = this.engine.matchSecurity(url, '')
        if (m.blocked) {
          this.record(wc, url, 'mainFrame', m.filter ?? 'security list', topHost)
          return { redirectURL: `lumen://blocked/?url=${encodeURIComponent(url)}&rule=${encodeURIComponent(m.filter ?? '')}` }
        }
      }
      return null
    }

    if (topHost && this.isAllowlisted(topHost)) return null
    if (topUrl.startsWith('lumen://')) return null

    // Optional strict mode: refuse third-party scripts and frames that no rule explicitly allows.
    const type = details.resourceType
    const m = this.engine.match(url, topUrl || details.referrer, type)
    if (m.blocked) {
      this.record(wc, url, type, m.filter ?? '', topHost)
      if (m.redirectUrl) { const r = this.resourceUrl(m.redirectUrl); if (r) return { redirectURL: r } }
      return { cancel: true }
    }
    if (this.cfg.strictThirdParty && !m.exception && (type === 'script' || type === 'subFrame') && isThirdParty(url, topUrl)) {
      this.record(wc, url, type, 'strict third-party mode', topHost)
      return { cancel: true }
    }
    return null
  }

  /** CSP directives some filters inject ($csp). */
  cspFor(details: Electron.OnHeadersReceivedListenerDetails): string | undefined {
    if (!this.active()) return undefined
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') return undefined
    const wc = details.webContents
    const top = wc && !wc.isDestroyed() ? wc.getURL() : ''
    const host = safeHost(top || details.url)
    if (host && this.isAllowlisted(host)) return undefined
    return this.engine.cspFor(details.url, details.referrer || top, details.resourceType)
  }

  /** Check a navigation or redirect target (used for redirect blocking). */
  shouldBlockNavigation(target: string, from: string): { blocked: boolean; rule?: string } {
    if (!this.active() || !this.cfg.redirectBlocking) return { blocked: false }
    const host = safeHost(target)
    if (!host || this.isAllowlisted(host) || this.isAllowlisted(safeHost(from))) return { blocked: false }
    const s = this.engine.matchSecurity(target, from)
    if (s.blocked) return { blocked: true, rule: s.filter }
    const m = this.engine.match(target, from, 'subFrame')
    return m.blocked ? { blocked: true, rule: m.filter } : { blocked: false }
  }

  shouldBlockPopup(target: string, from: string): { blocked: boolean; rule?: string } {
    if (!this.active() || !this.cfg.popupBlocking) return { blocked: false }
    if (this.isAllowlisted(safeHost(from))) return { blocked: false }
    const s = this.engine.matchSecurity(target, from)
    if (s.blocked) return { blocked: true, rule: s.filter }
    const m = this.engine.matchPopup(target, from)
    return m.blocked ? { blocked: true, rule: m.filter } : { blocked: false }
  }

  // ------------------------------------------------------------------ cosmetic filtering
  registerSession(ses: Session) {
    if (!this.preloadPath) {
      try { this.preloadPath = require.resolve('@ghostery/adblocker-electron-preload') } catch (e) { console.error('[adblock] cosmetic preload not found', e) }
    }
    if (this.preloadPath) {
      try { ses.registerPreloadScript({ type: 'frame', filePath: this.preloadPath, id: 'lumen-adblock-cosmetic' }) } catch (e) { console.error('[adblock] preload registration failed', e) }
    }
  }

  private installCosmeticHandler() {
    if (this.cosmeticHandlerInstalled) return
    this.cosmeticHandlerInstalled = true
    ipcMain.handle(PRELOAD_CHANNEL_MUT, () => true)
    ipcMain.handle(PRELOAD_CHANNEL_INJECT, async (event, url: string, msg?: any) => {
      if (!this.active() || !this.cfg.cosmetic) return
      const topHost = safeHost(event.sender.getURL())
      if (topHost && this.isAllowlisted(topHost)) return
      if (typeof url !== 'string' || !/^https?:/i.test(url)) return
      const p = parseUrl(url)
      const r = this.engine.cosmetics(url, p.hostname || '', p.domain || '', msg, { frameId: event.frameId, processId: event.processId, lifecycle: msg?.lifecycle })
      if (!r.active) return
      try {
        if (r.styles) await event.sender.insertCSS(r.styles, { cssOrigin: 'user' })
        for (const s of r.scripts) event.sender.executeJavaScript(s, true).catch(() => {})
      } catch { /* frame navigated away */ }
    })
  }

  // ------------------------------------------------------------------ statistics
  private record(wc: WebContents | undefined, url: string, type: string, filter: string, topHost: string) {
    this.sessionBlocked++
    if (wc && !wc.isDestroyed()) {
      const s = this.tabStats(wc.id, topHost)
      s.count++
      const h = safeHost(url)
      s.byDomain[h] = (s.byDomain[h] ?? 0) + 1
      s.recent.unshift({ url, type, filter, time: Date.now(), tabId: wc.id })
      if (s.recent.length > MAX_RECENT) s.recent.length = MAX_RECENT
    }
    this.emitChanged(wc?.id)
  }

  private tabStats(id: number, host = ''): TabStats {
    let s = this.tabs.get(id)
    if (!s) { s = { host, count: 0, recent: [], byDomain: {}, popups: 0 }; this.tabs.set(id, s) }
    return s
  }

  noteMainNavigation(wcId: number, url: string) {
    this.tabs.set(wcId, { host: safeHost(url), count: 0, recent: [], byDomain: {}, popups: 0 })
    this.emitChanged(wcId)
  }

  notePopupBlocked(wcId: number, target: string, rule: string) {
    const s = this.tabStats(wcId)
    s.popups++; s.count++; this.sessionBlocked++
    s.recent.unshift({ url: target, type: 'popup', filter: rule, time: Date.now(), tabId: wcId })
    this.emitChanged(wcId)
  }

  forgetTab(id: number) { this.tabs.delete(id) }

  blockedCount(id: number) { return this.tabs.get(id)?.count ?? 0 }
  popupCount(id: number) { return this.tabs.get(id)?.popups ?? 0 }

  siteStats(wcId: number | null, url: string): SiteBlockStats {
    const host = safeHost(url)
    const s = wcId != null ? this.tabs.get(wcId) : undefined
    return {
      host,
      enabled: this.cfg.enabled && !this.isAllowlisted(host),
      globalEnabled: this.cfg.enabled,
      blockedOnPage: s?.count ?? 0,
      blockedSession: this.sessionBlocked,
      recent: s?.recent.slice(0, 100) ?? [],
      byDomain: s?.byDomain ?? {},
    }
  }

  status(): AdblockStatus {
    const statuses: FilterListStatus[] = this.cfg.lists.map((l) => ({
      id: l.id,
      lastUpdated: this.meta.data.status[l.id]?.lastUpdated ?? null,
      ruleCount: this.meta.data.status[l.id]?.ruleCount ?? 0,
      error: this.meta.data.status[l.id]?.error,
      updating: this.updating.has(l.id),
    }))
    const st = this.engine.stats
    return { ready: this.engine.ready, totalRules: st.totalRules, networkRules: st.networkRules, cosmeticRules: st.cosmeticRules, statuses, sessionBlocked: this.sessionBlocked, lastUpdate: this.meta.data.lastUpdate, customRuleErrors: this.customErrors, scriptletCount: this.engine.resourceCount, scriptletError: this.resourcesError }
  }

  private emitChanged(tabId?: number) {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => { this.emitTimer = null; this.emit('changed', tabId) }, 150)
  }

  flush() { this.meta.flush() }
}

export function safeHost(url: string): string {
  try { return new URL(url).hostname } catch { return '' }
}

export function isThirdParty(url: string, topUrl: string): boolean {
  if (!topUrl) return false
  const a = parseUrl(url), b = parseUrl(topUrl)
  if (!a.domain || !b.domain) return a.hostname !== b.hostname
  return a.domain !== b.domain
}
