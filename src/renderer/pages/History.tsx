import { useMemo, useState } from 'react'
import { invoke, useRemote, useSettings } from '../common/api.ts'
import { Empty, Favicon, PageShell, guard } from './shared.tsx'
import { openLink } from './util.tsx'
import { faviconFor } from '../common/api.ts'
import type { HistoryEntry } from '../../shared/types.ts'

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const RANGES: [string, () => number | null][] = [
  ['the last hour', () => Date.now() - 3600_000], ['today', () => startOfDay(new Date())],
  ['the last 7 days', () => Date.now() - 7 * 86400_000], ['the last 4 weeks', () => Date.now() - 28 * 86400_000], ['all time', () => null],
]

export function HistoryPage() {
  const [s, update] = useSettings()
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [limit, setLimit] = useState(300)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [range, setRange] = useState(1)
  const from = date ? new Date(date + 'T00:00:00').getTime() : undefined
  const to = date ? new Date(date + 'T23:59:59').getTime() : undefined
  const [res, reload] = useRemote<{ total: number; rows: HistoryEntry[] }>('history:query', [{ text, from, to, limit }], ['history:changed'])
  const groups = useMemo(() => {
    const m = new Map<string, HistoryEntry[]>()
    for (const r of res?.rows ?? []) { const k = new Date(r.visitedAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); (m.get(k) ?? m.set(k, []).get(k)!).push(r) }
    return [...m.entries()]
  }, [res])
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const disabled = s && !s.historyEnabled
  return (
    <PageShell title="History" icon="history" wide actions={<>
      <select className="field" aria-label="Clear range" value={range} onChange={(e) => setRange(Number(e.target.value))}>{RANGES.map(([n], i) => <option key={n} value={i}>{n[0].toUpperCase() + n.slice(1)}</option>)}</select>
      <button className="btn" onClick={async () => { if (confirm(`Delete history from ${RANGES[range][0]}?`)) { await guard(invoke('history:clear', RANGES[range][1]()), 'History cleared'); reload() } }}>Clear history</button></>}>
      {disabled && <div className="issue warning" role="status">History is turned off, so new visits are not recorded. <button className="btn quiet" onClick={() => update({ historyEnabled: true })}>Turn on</button></div>}
      <div className="toolbar-row" style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="field" type="search" placeholder="Search history" aria-label="Search history" value={text} onChange={(e) => { setText(e.target.value); setLimit(300) }} />
        <input className="field" type="date" aria-label="Show a single day" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 170 }} />
        {date && <button className="btn quiet" onClick={() => setDate('')}>All days</button>}
        <span className="grow" style={{ flex: 1 }} />
        {sel.size > 0 && <button className="btn" onClick={async () => { await guard(invoke('history:remove', [...sel]), `Removed ${sel.size} item${sel.size === 1 ? '' : 's'}`); setSel(new Set()); reload() }}>Delete {sel.size} selected</button>}
      </div>
      {!res ? null : res.rows.length === 0 ? <Empty icon="history" title={text || date ? 'No matching pages' : 'No history yet'}>{text || date ? 'Try a different search or day.' : 'Pages you visit appear here.'}</Empty> : (
        <>
          {groups.map(([day, rows]) => (
            <section key={day} className="section"><h2>{day}</h2>
              <div className="card list">{rows.map((h) => (
                <div className="item" key={h.id}>
                  <input type="checkbox" aria-label={`Select ${h.title || h.url}`} checked={sel.has(h.id)} onChange={() => toggle(h.id)} />
                  <span className="muted" style={{ width: 52, fontVariantNumeric: 'tabular-nums' }}>{new Date(h.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <Favicon src={h.favicon || faviconFor(h.url)} />
                  <a className="grow" href={h.url} onClick={(e) => openLink(e, h.url)}><div className="title">{h.title || h.url}</div><div className="sub">{h.url}</div></a>
                  <button className="icon-btn" aria-label="Remove from history" title="Remove" onClick={async () => { await invoke('history:remove', [h.id]); reload() }}>×</button>
                </div>))}</div></section>
          ))}
          {res.total > res.rows.length && <div style={{ textAlign: 'center', padding: 16 }}><button className="btn" onClick={() => setLimit(limit + 300)}>Show more ({res.total - res.rows.length} left)</button></div>}
        </>
      )}
    </PageShell>
  )
}
