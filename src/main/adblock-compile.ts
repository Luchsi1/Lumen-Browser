// Pure compilation of filter lists into serialized engines. No Electron imports: it runs inside a worker thread
// (adblock-worker.ts) so the memory used while parsing is returned to the OS when the worker ends, and it is also
// the in-process fallback and what the unit tests use.
import fs from 'node:fs'
import { FiltersEngine } from '@ghostery/adblocker'

export interface EngineInput {
  id: string
  /** The list text itself (tests, small inputs). */
  text?: string
  /** Or a file that is read only when the list actually has to be compiled, so cached starts never load list text. */
  file?: string
}
export interface RuleCounts { network: number; cosmetic: number }

/** Main engine: network + cosmetic rules. */
export const ADS_CONFIG = { loadCosmeticFilters: true, loadNetworkFilters: true, loadGenericCosmeticsFilters: true, loadExtendedSelectors: false, enableHtmlFiltering: false } as const
/** Security engine (badware, URLhaus...) is only ever asked about URLs, so it carries no cosmetic rules. */
export const SECURITY_CONFIG = { loadCosmeticFilters: false, loadNetworkFilters: true, loadGenericCosmeticsFilters: false, loadExtendedSelectors: false, enableHtmlFiltering: false } as const

export interface CompileJob {
  main: EngineInput[]
  security: EngineInput[]
  customRules: string
  needAds: boolean
  needSecurity: boolean
}
export interface CompileResult {
  ads?: Uint8Array
  security?: Uint8Array
  adsCounts?: RuleCounts
  securityCounts?: RuleCounts
}

function joinInputs(inputs: EngineInput[], extra: string): string {
  const parts: string[] = []
  for (const i of inputs) parts.push(i.text ?? fs.readFileSync(i.file!, 'utf8'))
  parts.push(extra)
  return parts.join('\n')
}

export function countFilters(engine: FiltersEngine): RuleCounts {
  const f = engine.getFilters()
  return { network: f.networkFilters.length, cosmetic: f.cosmeticFilters.length }
}

export function compileEngine(inputs: EngineInput[], extra: string, config: typeof ADS_CONFIG | typeof SECURITY_CONFIG): FiltersEngine {
  return FiltersEngine.parse(joinInputs(inputs, extra), config as any)
}

/** Compile whichever engines are requested and return them serialized (plus rule counts, which the engine cannot give cheaply later). */
export function compileJob(job: CompileJob): CompileResult {
  const out: CompileResult = {}
  if (job.needAds) {
    const e = compileEngine(job.main, job.customRules, ADS_CONFIG)
    out.adsCounts = countFilters(e)
    out.ads = e.serialize()
  }
  if (job.needSecurity) {
    const e = compileEngine(job.security, '', SECURITY_CONFIG)
    out.securityCounts = countFilters(e)
    out.security = e.serialize()
  }
  return out
}
