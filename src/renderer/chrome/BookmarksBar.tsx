import { useMemo, useRef, useState } from 'react'
import { invoke, useRemote } from '../common/api.ts'
import { Icon } from '../common/icons.tsx'
import { openOverlay } from './overlay-client.ts'
import type { Bookmark } from '../../shared/types.ts'

export function BookmarksBar() {
  const [all] = useRemote<Bookmark[]>('bookmarks:list', [], ['bookmarks:changed'], [])
  const [dragOver, setDragOver] = useState<string | null>(null)
  const items = useMemo(() => (all ?? []).filter((b) => b.parentId === 'bar').sort((a, b) => a.index - b.index), [all])

  const drop = (e: React.DragEvent, targetId: string | null, index: number) => {
    e.preventDefault(); setDragOver(null)
    const id = e.dataTransfer.getData('application/x-lumen-bookmark')
    if (id) invoke('bookmarks:move', id, targetId ?? 'bar', index)
    else {
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
      if (/^https?:\/\//.test(url)) invoke('bookmarks:add', { title: url, url, parentId: targetId ?? 'bar' })
    }
  }

  return (
    <div className="bmbar" onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, 'bar', items.length)}
      onContextMenu={(e) => { e.preventDefault(); invoke('cmd', 'open.bookmarks') }}>
      {items.length === 0 && <span className="faint bm-empty">Bookmarks you add to the bar appear here. Press Ctrl+D on a page.</span>}
      {items.map((b, i) => <BarItem key={b.id} b={b} index={i} over={dragOver === b.id} setOver={setDragOver} drop={drop} />)}
      <button className="bm other" onClick={(e) => openOverlay('menu', e.currentTarget, { width: 320, height: 420, align: 'right', props: { mode: 'bookmark-folder', folderId: 'other' } })}><Icon name="folder" size={15} /><span>Other bookmarks</span></button>
    </div>
  )
}

function BarItem({ b, index, over, setOver, drop }: { b: Bookmark; index: number; over: boolean; setOver: (id: string | null) => void; drop: (e: React.DragEvent, target: string | null, index: number) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [imgBad, setImgBad] = useState(false)
  const folder = b.type === 'folder'
  return (
    <button
      ref={ref} className={`bm ${over ? 'drop' : ''}`} title={folder ? b.title : `${b.title}\n${b.url}`} draggable
      onDragStart={(e) => { e.dataTransfer.setData('application/x-lumen-bookmark', b.id); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(b.id) }} onDragLeave={() => setOver(null)}
      onDrop={(e) => { e.stopPropagation(); drop(e, folder ? b.id : 'bar', folder ? 0 : index) }}
      onClick={(e) => {
        if (folder) openOverlay('menu', e.currentTarget, { width: 320, height: 420, align: 'left', props: { mode: 'bookmark-folder', folderId: b.id } })
        else invoke('nav:go', b.url, { newTab: e.ctrlKey || e.metaKey })
      }}
      onAuxClick={(e) => { if (e.button === 1 && !folder) invoke('nav:go', b.url, { newTab: true }) }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openOverlay('bookmark-edit', e.currentTarget, { width: 320, height: 210, align: 'left', props: { id: b.id } }) }}
    >
      {folder ? <Icon name="folder" size={15} /> : b.favicon && !imgBad ? <img src={b.favicon} width={14} height={14} alt="" onError={() => setImgBad(true)} /> : <Icon name="globe" size={14} />}
      <span className="ellipsis">{b.title}</span>
    </button>
  )
}
