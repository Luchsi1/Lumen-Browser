// Unpack .zip and .crx (CRX2 / CRX3) extension packages safely. No Electron imports.
import fs from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'

const MAX_FILES = 5000
const MAX_TOTAL_BYTES = 500 * 1024 * 1024

/** Return the zip payload of a CRX file, or the buffer itself when it is already a zip. */
export function zipPayload(buf: Uint8Array): Uint8Array {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const isCrx = buf.length > 16 && buf[0] === 0x43 && buf[1] === 0x72 && buf[2] === 0x32 && buf[3] === 0x34 // "Cr24"
  if (isCrx) {
    const version = dv.getUint32(4, true)
    let offset: number
    if (version === 3) offset = 12 + dv.getUint32(8, true)
    else if (version === 2) offset = 16 + dv.getUint32(8, true) + dv.getUint32(12, true)
    else throw new Error(`Unsupported CRX version ${version}`)
    if (offset >= buf.length) throw new Error('Corrupt CRX header')
    return buf.subarray(offset)
  }
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) return buf // "PK"
  throw new Error('Not a .zip or .crx file')
}

/** Extract into destDir, rejecting entries that would escape it. Returns the directory that holds manifest.json. */
export function unpackExtension(buf: Uint8Array, destDir: string): string {
  const files = unzipSync(zipPayload(buf))
  const names = Object.keys(files)
  if (names.length > MAX_FILES) throw new Error('Package contains too many files')
  let total = 0
  const root = path.resolve(destDir)
  fs.mkdirSync(root, { recursive: true })
  for (const name of names) {
    if (name.endsWith('/')) continue
    total += files[name].length
    if (total > MAX_TOTAL_BYTES) throw new Error('Package is too large when unpacked')
    const target = path.resolve(root, name)
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Unsafe path in package: ${name}`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, files[name])
  }
  // manifest.json normally sits at the package root; tolerate one wrapper directory.
  if (fs.existsSync(path.join(root, 'manifest.json'))) return root
  const subs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
  for (const d of subs) if (fs.existsSync(path.join(root, d.name, 'manifest.json'))) return path.join(root, d.name)
  throw new Error('No manifest.json found in the package')
}
