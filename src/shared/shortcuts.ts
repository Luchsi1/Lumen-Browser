// Accelerator parsing and matching. Pure, shared by main process (key handling) and settings UI (display).

export interface Accel { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string }

const KEY_ALIASES: Record<string, string> = {
  plus: '+', minus: '-', left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown', esc: 'escape',
  del: 'delete', return: 'enter', space: ' ', pageup: 'pageup', pagedown: 'pagedown',
}

export function parseAccelerator(acc: string, platform: string = 'win32'): Accel | null {
  if (!acc) return null
  // "Ctrl++" ends in a literal plus key, which a plain split('+') would swallow.
  const raw = acc.endsWith('++') ? [...acc.slice(0, -2).split('+'), '+'] : acc.split('+')
  const out: Accel = { ctrl: false, shift: false, alt: false, meta: false, key: '' }
  const tokens = raw.map((t) => t.trim()).filter(Boolean)
  for (const t of tokens) {
    const l = t.toLowerCase()
    if (l === 'ctrl' || l === 'control') out.ctrl = true
    else if (l === 'cmdorctrl' || l === 'commandorcontrol') { if (platform === 'darwin') out.meta = true; else out.ctrl = true }
    else if (l === 'shift') out.shift = true
    else if (l === 'alt' || l === 'option') out.alt = true
    else if (l === 'meta' || l === 'cmd' || l === 'command' || l === 'super') out.meta = true
    else out.key = KEY_ALIASES[l] ?? l
  }
  return out.key ? out : null
}

export interface KeyInput { key: string; control?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }

const SYMBOL_KEYS = new Set(['+', '=', '-', '_'])

export function matches(input: KeyInput, acc: Accel): boolean {
  if (!!input.control !== acc.ctrl || !!input.alt !== acc.alt || !!input.meta !== acc.meta) return false
  const key = input.key.toLowerCase()
  const normalizedKey = key === 'add' ? '+' : key === 'subtract' ? '-' : key
  if (normalizedKey !== acc.key) return false
  // Shift is part of how '+' is typed on most layouts, so it does not count for symbol keys.
  if (SYMBOL_KEYS.has(acc.key)) return true
  return !!input.shift === acc.shift
}

export function formatAccelerator(acc: string): string {
  return acc.replace(/CmdOrCtrl/g, 'Ctrl').replace(/\bPlus\b/g, '+')
}

/** Build a canonical accelerator string from a keydown event in the settings UI. Returns null for bare modifier presses. */
export function acceleratorFromEvent(e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('CmdOrCtrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Meta')
  let k = e.key
  if (k === ' ') k = 'Space'
  else if (k === '+') k = 'Plus'
  else if (k.length === 1) k = k.toUpperCase()
  else if (k.startsWith('Arrow')) k = k.slice(5)
  return [...mods, k].join('+')
}
