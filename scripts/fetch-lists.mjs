// Downloads the built-in filter lists into resources/filterlists so the installer ships with them
// (blocking then works on first launch, offline). Run in CI before packaging. Failures of single
// lists are reported but do not stop the build: the app downloads missing lists at first start.
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { BUILTIN_LISTS } from '../src/shared/defaults.ts'

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'filterlists')
await mkdir(out, { recursive: true })
let ok = 0
for (const l of BUILTIN_LISTS) {
  if (!l.enabled) continue
  try {
    const r = await fetch(l.url, { signal: AbortSignal.timeout(60_000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const text = await r.text()
    if (text.length < 500) throw new Error('response too small')
    await writeFile(path.join(out, `${l.id}.txt`), text)
    console.log(`ok   ${l.id} (${(text.length / 1024).toFixed(0)} KB)`); ok++
  } catch (e) { console.warn(`FAIL ${l.id}: ${e.message}`) }
}
console.log(`${ok} lists bundled`)
