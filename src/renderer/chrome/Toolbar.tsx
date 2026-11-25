import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, useEvent } from '../common/api.ts'
import { Icon } from '../common/icons.tsx'
import { openOverlay } from './overlay-client.ts'
import { ExtensionButtons } from './ExtensionButtons.tsx'
import { displayUrl } from '../../shared/url.ts'
import type { Settings, SuggestionItem, TabState, WindowState } from '../../shared/types.ts'

export function Toolbar({ state, active, settings }: { state: WindowState; active: TabState | null; settings: Settings }) {
  const tb = settings.toolbar
  const starRef = useRef<HTMLButtonElement>(null)
  const [bookmarked, setBookmarked] = useState(false)
  const activeUrl = active?.url ?? ''

  const refreshBookmark = useCallback(() => {
    if (!activeUrl || !/^https?:/.test(activeUrl)) { setBookmarked(false); return }
    invoke('bookmarks:find', activeUrl).then((b) => setBookmarked(!!b))
  }, [activeUrl])
  useEffect(refreshBookmark, [refreshBookmark])
  useEvent('bookmarks:changed', refreshBookmark)

  const toggleBookmark = useCallback(async () => {
    if (!active || !/^https?:/.test(active.url)) return
    let bm = await invoke('bookmarks:find', active.url)
    if (!bm) bm = await invoke('bookmarks:add', { title: active.title || active.url, url: active.url, favicon: active.favicon, parentId: 'bar' })
    setBookmarked(true)
    if (starRef.current) openOverlay('bookmark-edit', starRef.current, { width: 320, height: 210, props: { id: bm.id } })
  }, [active])
  useEvent('cmd:bookmark', toggleBookmark)

  const btn = (name: Parameters<typeof Icon>[0]['name'], title: string, onClick: () => void, extra: { disabled?: boolean; ref?: React.Ref<HTMLButtonElement>; on?: boolean } = {}) => (
    <button ref={extra.ref} className={`icon-btn ${extra.on ? 'on' : ''}`} title={title} aria-label={title} disabled={extra.disabled} onClick={onClick}><Icon name={name} /></button>
  )

  return (
    <div className="toolbar">
      {btn('back', 'Back (Alt+Left)', () => invoke('cmd', 'nav.back'), { disabled: !active?.canGoBack })}
      {btn('forward', 'Forward (Alt+Right)', () => invoke('cmd', 'nav.forward'), { disabled: !active?.canGoForward })}
      {active?.loading ? btn('stop', 'Stop loading (Esc)', () => invoke('cmd', 'nav.stop')) : btn('reload', 'Reload (Ctrl+R)', () => invoke('cmd', 'nav.reload'))}
      {tb.home && btn('home', 'Home (Alt+Home)', () => invoke('cmd', 'nav.home'))}

      <Omnibox active={active} />

      {active && active.popupBlocked > 0 && (
        <button className="popup-blocked" title={`${active.popupBlocked} pop-up${active.popupBlocked === 1 ? '' : 's'} blocked. Click to always allow on this site.`}
          onClick={() => invoke('tab:allowPopups', active.id)}><Icon name="popup" size={15} /><span>{active.popupBlocked}</span></button>
      )}
      {tb.bookmark && <button ref={starRef} className={`icon-btn star ${bookmarked ? 'on' : ''}`} title={bookmarked ? 'Edit bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'} aria-label="Bookmark this page" onClick={toggleBookmark}><Icon name="star" {...({ filled: bookmarked } as any)} /></button>}

      {tb.adblock && <ShieldButton active={active} enabled={settings.adblock.enabled} />}
      {!settings.hideExtensions && !state.isPrivate && <ExtensionButtons active={active} pinned={settings.pinnedExtensions} showMenu={tb.extensions} />}
      {tb.downloads && <DownloadsButton />}
      {tb.sidePanel && btn('sidebar', 'Side panel (Ctrl+Shift+E)', () => invoke('sidepanel:toggle'), { on: state.sidePanelOpen })}
      {tb.profile && <ProfileButton isPrivate={state.isPrivate} profileId={state.profileId} />}
      <MenuButton />
    </div>
  )
}

function ShieldButton({ active, enabled }: { active: TabState | null; enabled: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  const internal = !active || !/^https?:/.test(active.url)
  const count = active?.blockedCount ?? 0
  return (
    <button ref={ref} className={`icon-btn shield ${enabled && !internal ? 'on' : ''}`} title={enabled ? `Ad blocker: ${count} blocked on this page` : 'Ad blocker is off'} aria-label="Ad blocker"
      onClick={() => ref.current && openOverlay('adblock', ref.current, { width: 340, height: 440, props: { tabId: active?.id ?? null } })}>
      <Icon name={enabled ? 'shield' : 'shieldOff'} />
      {enabled && count > 0 && !internal && <span className="badge">{count > 999 ? '999+' : count}</span>}
    </button>
  )
}

function DownloadsButton() {
  const ref = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(0)
  const load = useCallback(() => { invoke('downloads:list').then((l: any[]) => setBusy(l.filter((d) => d.status === 'progressing' || d.status === 'paused').length)) }, [])
  useEffect(load, [load])
  useEvent('downloads:changed', load)
  useEvent('downloads:started', () => { if (ref.current) openOverlay('downloads', ref.current, { width: 360, height: 420 }) })
  return (
    <button ref={ref} className={`icon-btn ${busy ? 'on' : ''}`} title="Downloads (Ctrl+J)" aria-label="Downloads" onClick={() => ref.current && openOverlay('downloads', ref.current, { width: 360, height: 420 })}>
      <Icon name="download" />{busy > 0 && <span className="badge dot" />}
    </button>
  )
}

function ProfileButton({ isPrivate, profileId }: { isPrivate: boolean; profileId: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [profiles, setProfiles] = useState<{ id: string; name: string; color: string }[]>([])
  useEffect(() => { invoke('profiles:list').then((r) => setProfiles(r.profiles)) }, [])
  const p = profiles.find((x) => x.id === profileId)
  return (
    <button ref={ref} className="icon-btn profile" title={isPrivate ? 'Private window' : `Profile: ${p?.name ?? ''}`} aria-label="Profile"
      onClick={() => ref.current && openOverlay('profiles', ref.current, { width: 280, height: 320 })}>
      {isPrivate ? <Icon name="incognito" /> : <span className="avatar" style={{ background: p?.color ?? 'var(--accent)' }}>{(p?.name ?? '?').charAt(0).toUpperCase()}</span>}
    </button>
  )
}

function MenuButton() {
  const ref = useRef<HTMLButtonElement>(null)
  return <button ref={ref} className="icon-btn" title="Menu" aria-label="Menu" onClick={() => ref.current && openOverlay('menu', ref.current, { width: 300, height: 480 })}><Icon name="dots" /></button>
}

// ---------------------------------------------------------------- address bar
function Omnibox({ active }: { active: TabState | null }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const secRef = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [items, setItems] = useState<SuggestionItem[]>([])
  const [sel, setSel] = useState(-1)
  const reqId = useRef(0)
  const timer = useRef<number | undefined>(undefined)

  const shown = editing ? text : displayUrl(active?.url ?? '')

  const closeList = useCallback(() => { setItems([]); setSel(-1); invoke('overlay:hide') }, [])

  const rows: SuggestionItem[] = text.trim() ? [{ type: 'search', text: text.trim() }, ...items] : []

  // Keep the dropdown (drawn by the overlay view) in step with the list and selection.
  useEffect(() => {
    if (!editing || !wrapRef.current || rows.length === 0) return
    const r = wrapRef.current.getBoundingClientRect()
    openOverlay('suggestions', r, { focus: false, width: Math.round(r.width), height: Math.min(rows.length, 9) * 40 + 12, props: { rows, selected: sel } })
  }, [editing, rows.length, sel, items])

  const go = useCallback((value: string, newTab = false) => {
    closeList(); setEditing(false)
    inputRef.current?.blur()
    invoke('nav:go', value, { newTab })
  }, [closeList])

  useEvent('cmd:focusAddress', () => { inputRef.current?.focus(); inputRef.current?.select() })
  useEvent('suggestion:pick', (value: string) => go(value))

  const onChange = (v: string) => {
    setText(v); setSel(-1)
    window.clearTimeout(timer.current)
    if (!v.trim()) { setItems([]); invoke('overlay:hide'); return }
    const id = ++reqId.current
    timer.current = window.setTimeout(async () => {
      const r: SuggestionItem[] = await invoke('omnibox:suggest', v)
      if (id === reqId.current) setItems(r)
    }, 70)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return
      e.preventDefault()
      const n = rows.length
      setSel((s) => (e.key === 'ArrowDown' ? (s + 1) % n : (s - 1 + n) % n))
    } else if (e.key === 'Enter') {
      const pick = sel >= 0 ? rows[sel] : null
      const value = pick ? (pick.url ?? pick.text) : text
      go(value, e.altKey)
    } else if (e.key === 'Escape') {
      if (rows.length) closeList()
      else { setEditing(false); inputRef.current?.blur() }
    }
  }

  // Preview the selected suggestion in the field like other browsers do.
  const preview = sel >= 0 && rows[sel] ? (rows[sel].url ?? rows[sel].text) : null

  return (
    <div className={`omnibox ${editing ? 'editing' : ''}`} ref={wrapRef}>
      <button ref={secRef} className={`sec ${active?.security ?? 'internal'}`} title="Site information" aria-label="Site information"
        onClick={() => active && secRef.current && openOverlay('site-info', secRef.current, { width: 330, height: 420, align: 'left', props: { tabId: active.id } })}>
        <Icon name={active?.security === 'secure' ? 'lock' : active?.security === 'insecure' || active?.security === 'error' ? 'warning' : active?.security === 'file' ? 'info' : 'search'} size={15} />
        {active?.security === 'insecure' && <span className="sec-label">Not secure</span>}
      </button>
      <input
        ref={inputRef} className="omni-input" spellCheck={false} autoComplete="off" aria-label="Address and search bar" placeholder="Search or enter address"
        value={preview ?? shown}
        onFocus={(e) => { setText(active?.url?.startsWith('lumen://newtab') ? '' : active?.url ?? ''); setEditing(true); setTimeout(() => e.target.select(), 0) }}
        onBlur={() => { setEditing(false); window.setTimeout(() => invoke('overlay:hide'), 120); setItems([]) }}
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKey}
      />
      {active?.zoom ? <button className="zoom-chip" title="Zoom level. Click to reset." onClick={() => invoke('page:zoomReset')}><Icon name="zoomIn" size={14} />{Math.round(Math.pow(1.2, active.zoom) * 100)}%</button> : null}
    </div>
  )
}
