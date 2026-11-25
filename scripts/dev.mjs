// Development mode: build with source maps, then launch Electron with remote debugging (http://localhost:9222).
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const r = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs'), '--dev'], { stdio: 'inherit', cwd: root })
if (r.status !== 0) process.exit(r.status ?? 1)
const electron = createRequire(import.meta.url)('electron')
const child = spawn(electron, [root, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, LUMEN_DEV: '1' } })
child.on('exit', (c) => process.exit(c ?? 0))
