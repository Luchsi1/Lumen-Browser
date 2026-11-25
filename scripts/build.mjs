// Production build: main + preload bundles with esbuild, renderer with Vite.
import { build } from 'esbuild'
import { build as viteBuild } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dev = process.argv.includes('--dev')
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true })

// Kept out of the bundle because they locate their own files (preload scripts) at runtime.
const external = ['electron', 'electron-chrome-extensions', 'electron-chrome-web-store', '@ghostery/adblocker-electron-preload']

const common = { bundle: true, platform: 'node', target: 'node22', sourcemap: dev ? 'inline' : false, minify: !dev, logLevel: 'info', absWorkingDir: root }

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js', format: 'cjs', external })
// Sandboxed preloads can only require('electron'); everything else must be bundled in.
await build({ ...common, entryPoints: ['src/preload/chrome.ts'], outfile: 'dist/preload/chrome.js', format: 'cjs', external: ['electron'] })
await build({ ...common, entryPoints: ['src/preload/page.ts'], outfile: 'dist/preload/page.js', format: 'cjs', external: ['electron'] })

await viteBuild({ configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn', mode: dev ? 'development' : 'production' })
console.log('build complete')
