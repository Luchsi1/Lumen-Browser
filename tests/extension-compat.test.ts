import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeManifest, scanApiUsage, describeHostAccess } from '../src/main/extension-compat.ts'

test('simple MV3 extension is full', () => {
  const r = analyzeManifest({ manifest: { manifest_version: 3, name: 'x', version: '1', permissions: ['storage', 'scripting'], action: {} } })
  assert.equal(r.level, 'partial') // action is partial (enable/disable missing)
  const r2 = analyzeManifest({ manifest: { manifest_version: 3, name: 'x', version: '1', permissions: ['storage'] } })
  assert.equal(r2.level, 'full')
})

test('declarativeNetRequest content blocker is limited and explained', () => {
  const r = analyzeManifest({ manifest: { manifest_version: 3, name: 'ubol', version: '1', permissions: ['declarativeNetRequest'], declarative_net_request: { rule_resources: [] } } })
  assert.equal(r.level, 'limited')
  assert.ok(r.issues.some((i) => i.level === 'error' && /declarativeNetRequest/.test(i.message)))
})

test('MV2 gets a warning', () => {
  const r = analyzeManifest({ manifest: { manifest_version: 2, name: 'old', version: '1', permissions: ['storage'] } })
  assert.equal(r.level, 'partial')
  assert.ok(r.issues.some((i) => /Manifest V2/.test(i.message)))
})

test('bad manifest is unsupported', () => {
  assert.equal(analyzeManifest({ manifest: { manifest_version: 1, name: 'a', version: '1' } }).level, 'unsupported')
  assert.equal(analyzeManifest({ manifest: { manifest_version: 3 } }).level, 'unsupported')
})

test('script scanning finds unsupported APIs used in code', () => {
  const r = analyzeManifest({ manifest: { manifest_version: 3, name: 'x', version: '1', permissions: ['storage'] }, scripts: { 'bg.js': 'chrome.history.search({text:""}); chrome.storage.local.get(1)' } })
  assert.ok(r.apisUsed.includes('history'))
  assert.equal(r.level, 'limited')
})

test('scanApiUsage', () => {
  const s = scanApiUsage('chrome.runtime.sendMessage(1); browser.tabs.query({}); const chromeX = 1; chromeX.cookies.get(); window.chrome.windows.getAll()')
  assert.ok(s.has('runtime') && s.has('tabs') && s.has('windows'))
  assert.ok(!s.has('cookies'), 'identifiers merely starting with "chrome" must not match')
})

test('unknown namespaces are reported as unverified, not hidden', () => {
  const r = analyzeManifest({ manifest: { manifest_version: 3, name: 'x', version: '1' }, scripts: { 'a.js': 'chrome.runtime.id; chrome.alarms.create("a")' } })
  assert.ok(r.issues.some((i) => /alarms/.test(i.message)))
})

test('host access description', () => {
  assert.match(describeHostAccess(['<all_urls>']), /all websites/)
  assert.match(describeHostAccess([]), /No website/)
  assert.match(describeHostAccess(['https://a.com/*']), /1 site pattern:/)
})
