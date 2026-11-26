import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FilterEngineManager, countRuleLines } from '../src/main/adblock-engine.ts'

const LIST = `! Title: test
[Adblock Plus 2.0]
||ads.example.com^
||tracker.test^$third-party
/banner/*$image
@@||ads.example.com/allowed.js^
||malware.bad^$document
example.org##.sponsored
##.generic-ad
||popads.test^
`
const SEC = `||evil-phish.test^$document\n||malware.bad^`

function mk(cache?: string) {
  const m = new FilterEngineManager(cache)
  m.build([{ id: 'a', text: LIST }], [{ id: 's', text: SEC }], '||custom-block.test^')
  return m
}

test('blocks matching network requests', () => {
  const m = mk()
  assert.equal(m.match('https://ads.example.com/x.js', 'https://news.com/', 'script').blocked, true)
  assert.equal(m.match('https://news.com/banner/a.png', 'https://news.com/', 'image').blocked, true)
  assert.equal(m.match('https://news.com/article', 'https://news.com/', 'xhr').blocked, false)
})

test('exception rules win', () => {
  const m = mk()
  assert.equal(m.match('https://ads.example.com/allowed.js', 'https://news.com/', 'script').blocked, false)
})

test('third-party option is respected', () => {
  const m = mk()
  assert.equal(m.match('https://tracker.test/p.gif', 'https://news.com/', 'image').blocked, true)
  assert.equal(m.match('https://tracker.test/p.gif', 'https://tracker.test/', 'image').blocked, false)
})

test('user custom rules apply', () => {
  const m = mk()
  assert.equal(m.match('https://custom-block.test/a.js', 'https://news.com/', 'script').blocked, true)
})

test('cosmetic filters: hostname specific and generic', () => {
  const m = mk()
  const on = m.cosmetics('https://example.org/', 'example.org', 'example.org')
  assert.ok(on.styles.includes('.sponsored'), 'host rule')
  const other = m.cosmetics('https://other.com/', 'other.com', 'other.com')
  assert.ok(!other.styles.includes('.sponsored'))
  // Generic class rules are only returned once the page reports which classes it uses.
  const dom = m.cosmetics('https://other.com/', 'other.com', 'other.com', { classes: ['generic-ad', 'unrelated'] })
  assert.ok(dom.styles.includes('.generic-ad'))
})

test('security engine blocks top level navigation', () => {
  const m = mk()
  assert.equal(m.matchSecurity('https://evil-phish.test/login').blocked, true)
  assert.equal(m.matchSecurity('https://malware.bad/').blocked, true)
  assert.equal(m.matchSecurity('https://example.com/').blocked, false)
})

test('popup filter', () => {
  const m = mk()
  assert.equal(m.matchPopup('https://popads.test/click?id=1', 'https://news.com/').blocked, true)
  assert.equal(m.matchPopup('https://news.com/', 'https://news.com/').blocked, false)
})

test('invalid custom rules are reported', () => {
  const m = new FilterEngineManager()
  const s = m.build([], [], '||ok.test^\n##+js(\n$$$bad$$$')
  assert.ok(s.customErrors.length >= 1, JSON.stringify(s.customErrors))
})

test('rule counts', () => {
  const m = mk()
  assert.ok(m.stats.networkRules >= 6)
  assert.ok(m.stats.cosmeticRules >= 2)
  assert.equal(countRuleLines(LIST), 8)
})

test('serialized cache round trips and is keyed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-eng-'))
  const a = new FilterEngineManager(dir)
  a.build([{ id: 'a', text: LIST }], [{ id: 's', text: SEC }], '', 'k1')
  assert.ok(fs.existsSync(path.join(dir, 'engine-ads.bin')))
  // Second manager with same key must load from cache, even when given empty inputs.
  const b = new FilterEngineManager(dir)
  b.build([], [], '', 'k1')
  assert.equal(b.match('https://ads.example.com/x.js', 'https://news.com/', 'script').blocked, true)
  // Different key rebuilds from inputs.
  const c = new FilterEngineManager(dir)
  c.build([], [], '', 'k2')
  assert.equal(c.match('https://ads.example.com/x.js', 'https://news.com/', 'script').blocked, false)
})

test('scriptlets: ##+js rules produce scripts once resources are loaded', async () => {
  const { FilterEngineManager } = await import('../src/main/adblock-engine.ts')
  const fs = await import('node:fs')
  const res = new URL('../resources/filterlists/resources.json', import.meta.url)
  if (!fs.existsSync(res)) return // resources are downloaded at build time; skip when absent
  const m = new FilterEngineManager()
  m.setResources(fs.readFileSync(res, 'utf8'))
  m.build([{ id: 't', text: 'example.com##+js(set, window.__x, 1)\n' }], [], '')
  assert.ok(m.resourceCount > 50)
  const r = m.cosmetics('https://example.com/', 'example.com', 'example.com')
  assert.ok(r.scripts.length > 0, 'scriptlet code is generated')
  assert.throws(() => m.setResources('not json'))
})
