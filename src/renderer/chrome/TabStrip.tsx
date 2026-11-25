import { useMemo, useRef, useState } from 'react'
import { invoke } from '../common/api.ts'
import { Icon } from '../common/icons.tsx'
import { openOverlay } from './overlay-client.ts'
import type { TabGroup, TabState, WindowState } from '../../shared/types.ts'

type Item = { kind: 'tab'; tab: TabState; group: TabGroup | null } | { kind: 'group'; group: TabGroup; count: number }

export function TabStrip({ state }: { state: WindowState }) {
  const [dragId, setDragId] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ index: number; x: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    const seen = new Set<string>()
    for (const tab of state.tabs) {
      const group = tab.groupId ? state.groups.find((g) => g.id === tab.groupId) ?? null : null
      if (group && !seen.has(group.id)) { seen.add(group.id); out.push({ kind: 'group', group, count: state.tabs.filter((t) => t.groupId === group.id).length }) }
      if (group?.collapsed && tab.id !== state.activeTabId) continue
      out.push({ kind: 'tab', tab, group })
    }
    return out
  }, [state.tabs, state.groups, state.activeTabId])

  const pinnedCount = state.tabs.filter((t) => t.pinned).length

  // Work out where a dragged tab would land from the cursor position, among the other tabs.
  function computeDrop(clientX: number) {
    const el = listRef.current
    if (!el || dragId == null) return null
    const nodes = Array.from(el.querySelectorAll<HTMLElement>('[data-tab-id]')).filter((n) => Number(n.dataset.tabId) !== dragId)
    const others = state.tabs.filter((t) => t.id !== dragId)
    let index = others.length
    let x = nodes.length ? nodes[nodes.length - 1].getBoundingClientRect().right : el.getBoundingClientRect().left
    for (let i = 0; i < nodes.length; i++) {
      const r = nodes[i].getBoundingClientRect()
      if (clientX < r.left + r.width / 2) { index = others.findIndex((t) => t.id === Number(nodes[i].dataset.tabId)); x = r.left; break }
    }
    return { index, x, others }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const c = computeDrop(e.clientX)
    if (c && dragId != null) {
      const left = c.others[c.index - 1], right = c.others[c.index]
      const dragged = state.tabs.find((t) => t.id === dragId)
      // Dropping between two tabs of one group (or at the edge of one, beside a group tab) puts the tab in that group.
      let groupId: string | null = null
      if (left?.groupId && left.groupId === right?.groupId) groupId = left.groupId
      if (dragged?.pinned) groupId = null
      invoke('tab:move', dragId, c.index, groupId)
    }
    setDragId(null); setDrop(null)
  }

  return (
    <div className="strip">
      <div
        className="strip-inner"
        ref={listRef}
        onDragOver={(e) => { if (dragId == null) return; e.preventDefault(); const c = computeDrop(e.clientX); setDrop(c ? { index: c.index, x: c.x } : null) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null) }}
        onDrop={onDrop}
      >
        {items.map((it) => it.kind === 'group'
          ? <GroupChip key={'g' + it.group.id} group={it.group} count={it.count} />
          : <Tab key={it.tab.id} tab={it.tab} group={it.group} active={it.tab.id === state.activeTabId} divider={it.tab.pinned && state.tabs.indexOf(it.tab) === pinnedCount - 1}
              onDragStart={() => setDragId(it.tab.id)} onDragEnd={() => { setDragId(null); setDrop(null) }} dragging={dragId === it.tab.id} />)}
        <button className="icon-btn new-tab" title="New tab (Ctrl+T)" aria-label="New tab" onClick={() => { invoke('cmd', 'tab.new') }}><Icon name="plus" size={16} /></button>
        {drop && <div className="drop-marker" style={{ left: drop.x - (listRef.current?.getBoundingClientRect().left ?? 0) - 1 }} />}
        <div className="strip-fill" />
      </div>
    </div>
  )
}

function Tab({ tab, group, active, divider, dragging, onDragStart, onDragEnd }: { tab: TabState; group: TabGroup | null; active: boolean; divider: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void }) {
  const title = tab.title || (tab.loading ? 'Loading...' : 'New tab')
  const [imgFailed, setImgFailed] = useState(false)
  const showSpeaker = tab.audible || tab.muted
  return (
    <div
      role="tab" aria-selected={active} data-tab-id={tab.id} draggable
      className={`tab ${active ? 'active' : ''} ${tab.pinned ? 'pinned' : ''} ${dragging ? 'dragging' : ''} ${tab.discarded ? 'sleeping' : ''}`}
      style={group ? ({ '--group': group.color } as React.CSSProperties) : undefined}
      title={`${title}${tab.discarded ? ' (sleeping to save memory)' : ''}${tab.crashed ? ' (crashed, click to reload)' : ''}`}
      onMouseDown={(e) => { if (e.button === 0) invoke('tab:activate', tab.id); if (e.button === 1) { e.preventDefault(); invoke('tab:close', tab.id) } }}
      onContextMenu={(e) => { e.preventDefault(); invoke('tab:menu', tab.id) }}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', tab.url); e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragEnd={onDragEnd}
    >
      <span className="tab-icon">
        {tab.loading ? <span className="spinner" /> : tab.crashed ? <Icon name="warning" size={14} /> : tab.favicon && !imgFailed ? <img src={tab.favicon} alt="" width={16} height={16} onError={() => setImgFailed(true)} /> : <Icon name={tab.security === 'internal' ? 'sparkle' : 'globe'} size={15} />}
      </span>
      {!tab.pinned && <span className="tab-title ellipsis">{title}</span>}
      {showSpeaker && (
        <button className="tab-aux" aria-label={tab.muted ? 'Unmute tab' : 'Mute tab'} title={tab.muted ? 'Unmute tab' : 'Mute tab'}
          onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); invoke('tab:mute', tab.id, !tab.muted) }}>
          <Icon name={tab.muted ? 'mute' : 'volume'} size={14} />
        </button>
      )}
      {!tab.pinned && (
        <button className="tab-close" aria-label="Close tab" title="Close tab" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); invoke('tab:close', tab.id) }}><Icon name="close" size={13} /></button>
      )}
      {divider && <span className="pin-divider" />}
    </div>
  )
}

function GroupChip({ group, count }: { group: TabGroup; count: number }) {
  return (
    <button
      className={`group-chip ${group.collapsed ? 'collapsed' : ''}`}
      style={{ '--group': group.color } as React.CSSProperties}
      title={`${group.name || 'Unnamed group'} (${count} tab${count === 1 ? '' : 's'}). Click to ${group.collapsed ? 'expand' : 'collapse'}, right-click to edit.`}
      onClick={() => invoke('group:update', group.id, { collapsed: !group.collapsed })}
      onContextMenu={(e) => { e.preventDefault(); openOverlay('group-edit', e.currentTarget, { width: 260, height: 200, align: 'left', props: { group } }) }}
    >
      {group.name || (group.collapsed ? count : '')}
    </button>
  )
}
