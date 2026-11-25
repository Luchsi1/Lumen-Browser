import { useMemo, useState, type ReactElement } from 'react'
import { invoke, useRemote, faviconFor } from '../common/api.ts'
import { Icon } from '../common/icons.tsx'
import { Empty, Favicon, PageShell, guard } from './shared.tsx'
import { openLink } from './util.tsx'
import type { Bookmark } from '../../shared/types.ts'

export function BookmarksPage() {
  const [all, reload] = useRemote<Bookmark[]>('bookmarks:list', [], ['bookmarks:changed'], [])
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [edit, setEdit] = useState<string | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; pos: 'before' | 'inside' | 'after' } | null>(null)
  const list = all ?? []
  const kids = useMemo(() => {
    const m = new Map<string | null, Bookmark[]>()
    for (const b of list) (m.get(b.parentId) ?? m.set(b.parentId, []).get(b.parentId)!).push(b)
    for (const a of m.values()) a.sort((x, y) => x.index - y.index)
    return m
  }, [list])
  const byId = useMemo(() => new Map(list.map((b) => [b.id, b])), [list])
  const roots = kids.get(null) ?? []
  const found = q.trim() ? list.filter((b) => b.type === 'bookmark' && `${b.title} ${b.url}`.toLowerCase().includes(q.toLowerCase())) : null

  const drop = async (target: Bookmark, pos: 'before' | 'inside' | 'after') => {
    if (!drag || drag === target.id) return
    const sibs = kids.get(target.parentId) ?? []
    if (pos === 'inside') await guard(invoke('bookmarks:move', drag, target.id, (kids.get(target.id) ?? []).length))
    else { const i = sibs.findIndex((s) => s.id === target.id); await guard(invoke('bookmarks:move', drag, target.parentId, pos === 'before' ? i : i + 1)) }
    setDrag(null); setOver(null); reload()
  }
  const row = (b: Bookmark, depth: number): ReactElement => {
    const isFolder = b.type === 'folder'
    const isRoot = b.parentId === null
    const cls = over?.id === b.id ? `drop-${over.pos}` : ''
    return (
      <div key={b.id}>
        <div className={`item bm-row ${cls}`} style={{ paddingLeft: 14 + depth * 20 }} draggable={!isRoot}
          onDragStart={(e) => { setDrag(b.id); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { setDrag(null); setOver(null) }}
          onDragOver={(e) => { if (!drag) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height; setOver({ id: b.id, pos: isFolder ? (y < 0.25 ? 'before' : y > 0.75 && !isRoot ? 'after' : 'inside') : y < 0.5 ? 'before' : 'after' }) }}
          onDrop={(e) => { e.preventDefault(); if (over) drop(b, over.pos) }}>
          {isFolder ? <button className="icon-btn" aria-label={collapsed.has(b.id) ? 'Expand' : 'Collapse'} onClick={() => setCollapsed((p) => { const n = new Set(p); n.has(b.id) ? n.delete(b.id) : n.add(b.id); return n })}><Icon name="chevron" size={14} style={{ transform: collapsed.has(b.id) ? '' : 'rotate(90deg)' }} /></button> : null}
          {isFolder ? <Icon name="folder" size={17} /> : <Favicon src={b.favicon || faviconFor(b.url!)} />}
          {edit === b.id ? <EditRow b={b} done={() => { setEdit(null); reload() }} /> : (
            <>
              {isFolder ? <div className="grow title">{b.title}</div> : <a className="grow" href={b.url} onClick={(e) => openLink(e, b.url!)}><div className="title">{b.title || b.url}</div><div className="sub">{b.url}</div></a>}
              {!isRoot && <>
                <button className="btn quiet" onClick={() => setEdit(b.id)}>Edit</button>
                <button className="icon-btn" aria-label={`Delete ${b.title}`} title="Delete" onClick={async () => { if (!isFolder || confirm(`Delete the folder "${b.title}" and everything in it?`)) { await guard(invoke('bookmarks:remove', b.id)); reload() } }}><Icon name="trash" size={16} /></button></>}
            </>)}
        </div>
        {isFolder && !collapsed.has(b.id) && (kids.get(b.id) ?? []).map((c) => row(c, depth + 1))}
        {isFolder && !collapsed.has(b.id) && (kids.get(b.id) ?? []).length === 0 && <div className="sub" style={{ padding: `6px 14px 6px ${54 + depth * 20}px`, color: 'var(--fg-faint)' }}>Empty folder</div>}
      </div>
    )
  }
  return (
    <PageShell title="Bookmarks" icon="bookmark" wide actions={<>
      <button className="btn" onClick={async () => { const n = prompt('Folder name'); if (n?.trim()) { await guard(invoke('bookmarks:add', { type: 'folder', title: n.trim(), parentId: roots[0]?.id ?? null })); reload() } }}>New folder</button>
      <button className="btn" onClick={async () => { const n = await guard(invoke('bookmarks:import')); if (typeof n === 'number') { reload() } }}>Import...</button>
      <button className="btn" onClick={() => guard(invoke('bookmarks:export'))}>Export...</button></>}>
      <div style={{ margin: '10px 0' }}><input className="field" type="search" style={{ maxWidth: 360 }} placeholder="Search bookmarks" aria-label="Search bookmarks" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <p className="section-desc">Drag a bookmark onto a folder to move it, or between two items to reorder.</p>
      {all && list.length === 0 ? <Empty icon="bookmark" title="No bookmarks yet">Press Ctrl+D on any page, or import a bookmarks file.</Empty> :
        found ? (found.length === 0 ? <Empty icon="search" title="No matching bookmarks" /> : <div className="card list">{found.map((b) => (
          <div className="item" key={b.id}><Favicon src={b.favicon || faviconFor(b.url!)} /><a className="grow" href={b.url} onClick={(e) => openLink(e, b.url!)}><div className="title">{b.title || b.url}</div><div className="sub">{byId.get(b.parentId ?? '')?.title ? `${byId.get(b.parentId ?? '')!.title} · ` : ''}{b.url}</div></a></div>))}</div>)
        : <div className="card list">{roots.map((r) => row(r, 0))}</div>}
    </PageShell>
  )
}

function EditRow({ b, done }: { b: Bookmark; done: () => void }) {
  const [title, setTitle] = useState(b.title)
  const [url, setUrl] = useState(b.url ?? '')
  const save = async () => { const r = await guard(invoke('bookmarks:update', b.id, b.type === 'folder' ? { title } : { title, url })); if (r !== undefined || true) done() }
  return (
    <form className="grow" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); save() }}>
      <input className="field" autoFocus aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
      {b.type === 'bookmark' && <input className="field" aria-label="Address" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 2, minWidth: 160 }} />}
      <button className="btn primary">Save</button><button type="button" className="btn" onClick={done}>Cancel</button>
    </form>
  )
}
