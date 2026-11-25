import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JsonStore, mergeDefaults } from '../src/main/store.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-store-'))

test('persists and reloads', () => {
  const dir = tmp()
  const a = new JsonStore({ dir, name: 's', defaults: { n: 1, list: [] as string[] } })
  a.data.n = 5; a.data.list.push('x'); a.save(); a.flush()
  const b = new JsonStore({ dir, name: 's', defaults: { n: 1, list: [] as string[] } })
  assert.equal(b.data.n, 5)
  assert.deepEqual(b.data.list, ['x'])
})

test('no leftover temp file after flush', () => {
  const dir = tmp()
  const a = new JsonStore({ dir, name: 's', defaults: { n: 1 } })
  a.data.n = 2; a.save(); a.flush()
  assert.ok(!fs.existsSync(path.join(dir, 's.json.tmp')))
})

test('recovers from corrupt main file using backup', () => {
  const dir = tmp()
  const a = new JsonStore({ dir, name: 's', defaults: { n: 1 } })
  a.data.n = 42; a.save(); a.flush() // first flush also writes a backup
  fs.writeFileSync(path.join(dir, 's.json'), '{"n": 4') // truncated, as after a crash mid-write
  const b = new JsonStore({ dir, name: 's', defaults: { n: 1 } })
  assert.equal(b.data.n, 42)
})

test('corrupt file with no backup falls back to defaults', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 's.json'), 'garbage')
  const b = new JsonStore({ dir, name: 's', defaults: { n: 7 } })
  assert.equal(b.data.n, 7)
})

test('new default keys are merged into old data', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 's.json'), JSON.stringify({ a: { x: 1 } }))
  const b = new JsonStore({ dir, name: 's', defaults: { a: { x: 0, y: 2 }, c: 3 } })
  assert.deepEqual(b.data, { a: { x: 1, y: 2 }, c: 3 })
})

test('mergeDefaults keeps arrays from raw', () => {
  assert.deepEqual(mergeDefaults({ l: [1, 2] }, { l: [3] }), { l: [3] })
})

test('backups are capped', () => {
  const dir = tmp()
  const a = new JsonStore({ dir, name: 's', defaults: { n: 0 }, backups: 2 })
  for (let i = 0; i < 5; i++) { a.data.n = i; a.backupNow() }
  const files = fs.readdirSync(path.join(dir, 'backups'))
  assert.ok(files.length <= 2, `got ${files.length}`)
})

test('memory mode never touches disk', () => {
  const dir = path.join(tmp(), 'nested')
  const a = new JsonStore({ dir, name: 's', defaults: { n: 1 }, memory: true })
  a.data.n = 9; a.save(); a.flush(); a.backupNow()
  assert.ok(!fs.existsSync(dir))
})
