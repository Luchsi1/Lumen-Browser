import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAccelerator, matches, acceleratorFromEvent } from '../src/shared/shortcuts.ts'

const ev = (key: string, mods: Partial<{ control: boolean; shift: boolean; alt: boolean; meta: boolean }> = {}) => ({ key, ...mods })

test('Ctrl+T', () => {
  const a = parseAccelerator('CmdOrCtrl+T')!
  assert.ok(matches(ev('t', { control: true }), a))
  assert.ok(matches(ev('T', { control: true }), a))
  assert.ok(!matches(ev('t', { control: true, shift: true }), a))
  assert.ok(!matches(ev('t'), a))
})

test('Ctrl+Shift+T is distinct from Ctrl+T', () => {
  const a = parseAccelerator('CmdOrCtrl+Shift+T')!
  assert.ok(matches(ev('T', { control: true, shift: true }), a))
  assert.ok(!matches(ev('t', { control: true }), a))
})

test('Ctrl+Tab and Ctrl+Shift+Tab', () => {
  assert.ok(matches(ev('Tab', { control: true }), parseAccelerator('Ctrl+Tab')!))
  assert.ok(matches(ev('Tab', { control: true, shift: true }), parseAccelerator('Ctrl+Shift+Tab')!))
  assert.ok(!matches(ev('Tab', { control: true, shift: true }), parseAccelerator('Ctrl+Tab')!))
})

test('zoom keys ignore shift for symbols', () => {
  assert.ok(matches(ev('+', { control: true, shift: true }), parseAccelerator('CmdOrCtrl+Plus')!))
  assert.ok(matches(ev('=', { control: true }), parseAccelerator('CmdOrCtrl+=')!))
  assert.ok(matches(ev('-', { control: true }), parseAccelerator('CmdOrCtrl+-')!))
  assert.ok(matches(ev('0', { control: true }), parseAccelerator('CmdOrCtrl+0')!))
})

test('function keys and arrows', () => {
  assert.ok(matches(ev('F11'), parseAccelerator('F11')!))
  assert.ok(matches(ev('ArrowLeft', { alt: true }), parseAccelerator('Alt+Left')!))
})

test('Ctrl++ literal', () => {
  const a = parseAccelerator('Ctrl++')!
  assert.equal(a.key, '+')
})

test('mac maps CmdOrCtrl to meta', () => {
  const a = parseAccelerator('CmdOrCtrl+T', 'darwin')!
  assert.ok(a.meta && !a.ctrl)
})

test('acceleratorFromEvent round trip', () => {
  const s = acceleratorFromEvent({ key: 'k', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })!
  assert.equal(s, 'CmdOrCtrl+Shift+K')
  assert.ok(matches(ev('K', { control: true, shift: true }), parseAccelerator(s)!))
  assert.equal(acceleratorFromEvent({ key: 'Control', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }), null)
  assert.equal(acceleratorFromEvent({ key: '+', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }), 'CmdOrCtrl+Plus')
})
