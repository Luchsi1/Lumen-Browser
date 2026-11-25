import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveInput, hostMatches, normalizeAllowEntry, displayUrl, isLocalOrPrivateHost } from '../src/shared/url.ts'

const S = 'https://duckduckgo.com/?q=%s'

test('plain hostnames become https URLs', () => {
  assert.deepEqual(resolveInput('example.com', S), { kind: 'url', url: 'https://example.com' })
  assert.deepEqual(resolveInput('  www.example.co.uk/path?x=1 ', S), { kind: 'url', url: 'https://www.example.co.uk/path?x=1' })
})

test('explicit schemes are kept', () => {
  assert.equal(resolveInput('http://example.com', S).url, 'http://example.com')
  assert.equal(resolveInput('file:///C:/a.html', S).url, 'file:///C:/a.html')
  assert.equal(resolveInput('view-source:https://a.com', S).url, 'view-source:https://a.com')
})

test('localhost and IPs are URLs, over http', () => {
  assert.equal(resolveInput('localhost:3000', S).url, 'http://localhost:3000')
  assert.equal(resolveInput('127.0.0.1:8080/x', S).url, 'http://127.0.0.1:8080/x')
  assert.equal(resolveInput('[::1]:80', S).url, 'http://[::1]:80')
})

test('queries become searches', () => {
  assert.deepEqual(resolveInput('hello world', S), { kind: 'search', url: 'https://duckduckgo.com/?q=hello%20world' })
  assert.equal(resolveInput('cats', S).kind, 'search')
  assert.equal(resolveInput('what is example.com?', S).kind, 'search')
  assert.equal(resolveInput('c++ tutorial', S).url, 'https://duckduckgo.com/?q=c%2B%2B%20tutorial')
})

test('internal pages', () => {
  assert.equal(resolveInput('about:settings', S).url, 'lumen://settings')
  assert.equal(resolveInput('chrome://history', S).url, 'lumen://history')
  assert.equal(resolveInput('lumen://downloads', S).url, 'lumen://downloads')
  assert.equal(resolveInput('', S).url, 'lumen://newtab')
})

test('javascript: is never navigated as a URL', () => {
  assert.equal(resolveInput('javascript:alert(1)', S).kind, 'search')
})

test('hostMatches', () => {
  assert.ok(hostMatches('a.b.example.com', 'example.com'))
  assert.ok(hostMatches('example.com', 'example.com'))
  assert.ok(!hostMatches('notexample.com', 'example.com'))
  assert.ok(hostMatches('x.example.com', '*.example.com'))
})

test('normalizeAllowEntry', () => {
  assert.equal(normalizeAllowEntry('https://www.Example.com/path'), 'example.com')
  assert.equal(normalizeAllowEntry(' Foo.org/ '), 'foo.org')
})

test('displayUrl and private hosts', () => {
  assert.equal(displayUrl('https://example.com/'), 'example.com')
  assert.equal(displayUrl('https://example.com/a?b=1'), 'example.com/a?b=1')
  assert.equal(displayUrl('lumen://newtab'), '')
  assert.ok(isLocalOrPrivateHost('192.168.1.5'))
  assert.ok(isLocalOrPrivateHost('localhost'))
  assert.ok(!isLocalOrPrivateHost('example.com'))
  assert.ok(!isLocalOrPrivateHost('8.8.8.8'))
})
