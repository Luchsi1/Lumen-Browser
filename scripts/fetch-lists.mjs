// Downloads the built-in filter lists into resources/filterlists so the installer ships with them
// (blocking then works on first launch, offline). Run in CI before packaging. A list that cannot be
// downloaded is reported and skipped: the app downloads missing lists at first start instead.
// Uses node:https (not fetch): on the GitHub Windows runner, fetch crashed with an undici assertion.
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import https from 'node:https'
import path from 'node:path'
import { BUILTIN_LISTS } from '../src/shared/defaults.ts'

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'filterlists')
await mkdir(out, { recursive: true })

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'Lumen-build', 'accept-encoding': 'identity' }, timeout: 60_000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        if (redirects <= 0) return reject(new Error('too many redirects'))
        return resolve(get(new URL(res.headers.location, url).href, redirects - 1))
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)) }
      const chunks = []
      res.on('data', (c) => chunks.push(c)); res.on('error', reject)
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

let ok = 0
for (const l of BUILTIN_LISTS) {
  if (!l.enabled) continue
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const text = await get(l.url)
      if (text.length < 500) throw new Error('response too small')
      await writeFile(path.join(out, `${l.id}.txt`), text)
      console.log(`ok   ${l.id} (${(text.length / 1024).toFixed(0)} KB)`); ok++
      break
    } catch (e) {
      console.warn(`${attempt === 3 ? 'FAIL' : 'retry'} ${l.id}: ${e.message}`)
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
}
try {
  const text = await get('https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json')
  JSON.parse(text)
  await writeFile(path.join(out, 'resources.json'), text)
  console.log(`ok   resources.json (${(text.length / 1024).toFixed(0)} KB)`)
} catch (e) { console.warn(`FAIL resources.json: ${e.message}`) }
console.log(`${ok} lists bundled`)
