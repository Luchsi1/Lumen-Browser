import { useEffect, useRef, useState } from 'react'
import { invoke, useEvent } from '../common/api.ts'
import { Icon } from '../common/icons.tsx'
import { openOverlay } from './overlay-client.ts'
import type { TabState } from '../../shared/types.ts'

interface Action { id: string; title?: string; text?: string; color?: string; popup?: string; iconModified?: number }

/** Pinned extension buttons plus the puzzle menu. Popups are opened by the extension library itself. */
export function ExtensionButtons({ active, pinned, showMenu }: { active: TabState | null; pinned: string[]; showMenu: boolean }) {
  const [partition, setPartition] = useState<string | null>(null)
  const [actions, setActions] = useState<Action[]>([])
  const puzzle = useRef<HTMLButtonElement>(null)

  useEffect(() => { invoke('extensions:partition').then(setPartition) }, [])

  useEffect(() => {
    const ba = window.browserAction
    if (!partition || !ba) return
    const onUpdate = (state: { actions: Action[] }) => setActions(state.actions)
    ba.addEventListener('update', onUpdate)
    ba.addObserver(partition)
    ba.getState(partition).catch(() => {})
    return () => { ba.removeEventListener('update', onUpdate); ba.removeObserver(partition) }
  }, [partition])

  // Extensions installed or removed while the window is open.
  useEvent('extensions:changed', () => { if (partition) window.browserAction?.getState(partition).catch(() => {}) })

  const visible = actions.filter((a) => pinned.includes(a.id))
  return (
    <>
      {visible.map((a) => (
        <button key={a.id} className="icon-btn ext-action" title={a.title || 'Extension'} aria-label={a.title || 'Extension'}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            window.browserAction?.activate(partition, { eventType: 'click', extensionId: a.id, tabId: active?.wcId, alignment: 'bottom right', anchorRect: { x: r.left, y: r.top, width: r.width, height: r.height } })
          }}>
          <img src={`crx://extension-icon/${a.id}/32/2?tabId=${active?.wcId ?? -1}&partition=${encodeURIComponent(partition ?? '')}${a.iconModified ? `&t=${a.iconModified}` : ''}`} width={18} height={18} alt="" />
          {a.text && <span className="badge" style={{ background: a.color || undefined }}>{a.text}</span>}
        </button>
      ))}
      {showMenu && <button ref={puzzle} className="icon-btn" title="Extensions" aria-label="Extensions" onClick={() => puzzle.current && openOverlay('extensions', puzzle.current, { width: 340, height: 420, props: { wcId: active?.wcId ?? null } })}><Icon name="puzzle" /></button>}
    </>
  )
}
