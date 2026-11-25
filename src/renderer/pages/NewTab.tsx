import { useEffect, useState } from 'react'
import { invoke, useRemote, useSettings, faviconFor } from '../common/api.ts'
import type { AdblockStatus, HistoryEntry } from '../../shared/types.ts'

export function NewTabPage() {
  const priv = window.lumen.isPrivate
  const [s] = useSettings()
  const [now, setNow] = useState(new Date())
  const [q, setQ] = useState('')
  const [sites] = useRemote<HistoryEntry[]>('history:top', [8], ['history:changed'], [])
  const [st] = useRemote<AdblockStatus>('adblock:status', [], ['adblock:changed'])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 10_000); return () => clearInterval(t) }, [])
  useEffect(() => { document.title = priv ? 'New private tab' : 'New tab' }, [priv])
  return (
    <div className={`nt ${priv ? 'private' : ''}`}>
      <main className="nt-main">
        <h1 className="nt-time">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</h1>
        <p className="nt-date">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <form className="nt-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) invoke('nav:go', q.trim()) }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or enter an address" aria-label="Search or enter an address" />
        </form>
        {priv ? (
          <div style={{ marginTop: 36, maxWidth: 560 }}>
            <h2 style={{ font: '600 18px var(--font-display)' }}>Private window</h2>
            <p className="muted">History, cookies and site data from this window are deleted when you close it. Downloads and bookmarks you save stay on your computer. Your internet provider, employer and the sites you visit can still see your activity. Extensions do not run here.</p>
          </div>
        ) : (sites ?? []).length > 0 && (
          <nav className="nt-sites" aria-label="Frequently visited">{(sites ?? []).map((h) => {
            const host = new URL(h.url).hostname.replace(/^www\./, '')
            return <a key={h.id} className="nt-site" href={h.url}><div className="tile"><img src={h.favicon || faviconFor(h.url)} alt="" onError={(e) => { const el = e.currentTarget; el.replaceWith(document.createTextNode(host[0]?.toUpperCase() ?? '?')) }} /></div><span className="n">{h.title || host}</span></a>
          })}</nav>
        )}
      </main>
      <footer className="nt-foot">
        {s && st && (s.adblock.enabled ? <span>{st.sessionBlocked.toLocaleString()} requests blocked since Lumen started</span> : <span>Ad blocker is off</span>)}
        <a href="lumen://settings">Settings</a><a href="lumen://bookmarks">Bookmarks</a><a href="lumen://history">History</a><a href="lumen://downloads">Downloads</a>
      </footer>
    </div>
  )
}
