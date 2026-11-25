import { useEffect, useState, useCallback, useRef } from 'react'
import type { Settings } from '../../shared/types.ts'

export interface LumenBridge {
  isPrivate: boolean
  invoke: (channel: string, ...args: unknown[]) => Promise<any>
  on: (channel: string, cb: (...args: any[]) => void) => () => void
}
declare global { interface Window { lumen: LumenBridge; browserAction?: any } }

export const invoke = <T = any>(channel: string, ...args: unknown[]): Promise<T> => window.lumen.invoke(channel, ...args)

export function useEvent(channel: string, cb: (...args: any[]) => void) {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => window.lumen.on(channel, (...a) => ref.current(...a)), [channel])
}

/** Load a value through IPC and reload it whenever one of the given events fires. */
export function useRemote<T>(channel: string, args: unknown[], events: string[] = [], initial?: T): [T | undefined, () => void] {
  const [value, setValue] = useState<T | undefined>(initial)
  const key = JSON.stringify(args)
  const load = useCallback(() => { invoke<T>(channel, ...args).then(setValue).catch((e) => console.error(channel, e)) }, [channel, key])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const offs = events.map((e) => window.lumen.on(e, load))
    return () => offs.forEach((o) => o())
  }, [load, events.join('|')])
  return [value, load]
}

export function useSettings(): [Settings | undefined, (patch: any) => Promise<{ restartRequired: boolean }>] {
  const [s, setS] = useState<Settings>()
  useEffect(() => {
    invoke<Settings>('settings:get').then((v) => { setS(v); applyTheme(v) })
    return window.lumen.on('settings:changed', (v: Settings) => { setS(v); applyTheme(v) })
  }, [])
  const update = useCallback((patch: any) => invoke('settings:set', patch), [])
  return [s, update]
}

export function applyTheme(s: Settings) {
  const r = document.documentElement
  r.style.setProperty('--accent', s.accent)
  // Choose a readable text colour for content placed on the accent.
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s.accent)
  if (m) {
    const [rr, gg, bb] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb
    r.style.setProperty('--accent-fg', lum > 0.4 ? '#101114' : '#ffffff')
  }
}

export function formatBytes(n: number): string {
  if (!isFinite(n) || n < 0) return ''
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`
}

export function formatEta(sec: number | null): string {
  if (sec == null) return ''
  if (sec < 60) return `${sec}s left`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s left`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m left`
}

export function timeAgo(ts: number | null): string {
  if (!ts) return 'never'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(ts).toLocaleDateString()
}

export function faviconFor(url: string): string {
  try { const u = new URL(url); return u.protocol.startsWith('http') ? `${u.origin}/favicon.ico` : '' } catch { return '' }
}
