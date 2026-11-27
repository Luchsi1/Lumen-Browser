// Filter-list compiler entry point, bundled to dist/main/adblock-worker.js. It runs either as an Electron utility process
// (preferred: when it exits, every byte the parser allocated goes back to the OS; a worker thread would leave that memory
// in the main process) or, as a fallback, as a worker thread. Both receive one CompileJob and answer once.
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { compileJob, type CompileJob } from './adblock-compile.ts'

function run(job: CompileJob): { ok: boolean; result?: unknown; error?: string } {
  try { return { ok: true, result: compileJob(job) } } catch (e: any) { return { ok: false, error: String(e?.stack ?? e) } }
}

const utilityPort = (process as any).parentPort as { once(ev: 'message', cb: (e: { data: CompileJob }) => void): void; postMessage(m: unknown): void } | undefined
if (utilityPort) utilityPort.once('message', (e) => utilityPort.postMessage(run(e.data)))
else if (!isMainThread && parentPort) parentPort.postMessage(run(workerData as CompileJob))
