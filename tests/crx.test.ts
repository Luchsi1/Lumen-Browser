import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { unpackExtension, zipPayload } from '../src/main/crx.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-crx-'))
const MANIFEST = JSON.stringify({ manifest_version: 3, name: 't', version: '1' })

function crx3(zip: Uint8Array, headerLen = 7): Uint8Array {
  const head = new Uint8Array(12 + headerLen)
  head.set([0x43, 0x72, 0x32, 0x34]) // Cr24
  const dv = new DataView(head.buffer)
  dv.setUint32(4, 3, true); dv.setUint32(8, headerLen, true)
  const out = new Uint8Array(head.length + zip.length)
  out.set(head); out.set(zip, head.length)
  return out
}

test('plain zip', () => {
  const zip = zipSync({ 'manifest.json': strToU8(MANIFEST), 'a/b.js': strToU8('1') })
  const dir = unpackExtension(zip, tmp())
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')))
  assert.equal(fs.readFileSync(path.join(dir, 'a/b.js'), 'utf8'), '1')
})

test('crx3 header is skipped', () => {
  const zip = zipSync({ 'manifest.json': strToU8(MANIFEST) })
  const dir = unpackExtension(crx3(zip, 123), tmp())
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')))
})

test('crx2 header is skipped', () => {
  const zip = zipSync({ 'manifest.json': strToU8(MANIFEST) })
  const head = new Uint8Array(16 + 5 + 9)
  head.set([0x43, 0x72, 0x32, 0x34]); const dv = new DataView(head.buffer)
  dv.setUint32(4, 2, true); dv.setUint32(8, 5, true); dv.setUint32(12, 9, true)
  const buf = new Uint8Array(head.length + zip.length); buf.set(head); buf.set(zip, head.length)
  assert.ok(fs.existsSync(path.join(unpackExtension(buf, tmp()), 'manifest.json')))
})

test('zip-slip entries are rejected and nothing is written outside', () => {
  const base = tmp()
  const dest = path.join(base, 'dest')
  const zip = zipSync({ 'manifest.json': strToU8(MANIFEST), '../evil.txt': strToU8('x') })
  assert.throws(() => unpackExtension(zip, dest), /Unsafe path/)
  assert.ok(!fs.existsSync(path.join(base, 'evil.txt')))
})

test('wrapper directory is tolerated', () => {
  const zip = zipSync({ 'ext/manifest.json': strToU8(MANIFEST) })
  const dir = unpackExtension(zip, tmp())
  assert.ok(dir.endsWith('ext'))
})

test('missing manifest and non-packages are errors', () => {
  assert.throws(() => unpackExtension(zipSync({ 'x.txt': strToU8('1') }), tmp()), /manifest/)
  assert.throws(() => zipPayload(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])), /Not a/)
})
