import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes, formatEta, invoke, useEvent, useRemote } from '../common/api.ts'
import { Icon, type IconName } from '../common/icons.tsx'
import type { Bookmark, DownloadRecord, ExtensionInfo, PermissionKind, PermissionValue, ProfileInfo, PromptRequest, SiteBlockStats, SiteInfo, SuggestionItem, TabGroup } from '../../shared/types.ts'

const open = (url: string, close: () => void) => { invoke('nav:go', url, { newTab: true }); close() }

// ---------------------------------------------------------------- ad blocker popup
export function AdblockPanel({ tabId, close }: { tabId: number | null; close: () => void }) {
  const [s, reload] = useRemote<SiteBlockStats>('adblock:site', [tabId], ['adblock:changed', 'settings:changed'])
  const [showList, setShowList] = useState(false)
  if (!s) return null
  const internal = !s.host
  const siteOn = s.enabled
  return (
    <>
      <div className="p-head"><Icon name={s.globalEnabled ? 'shield' : 'shieldOff'} size={20} /><h2>Ad blocker</h2>
        <button className="icon-btn" aria-label="Ad blocker settings" title="Ad blocker settings" onClick={() => open('lumen://adblock', close)}><Icon name="settings" size={16} /></button></div>
      {internal ? <div className="p-body muted">Protection applies to websites. This page is part of Lumen.</div> : (
        <>
          <div className="stat-hero"><span className="num">{s.blockedOnPage}</span><span className="label">blocked on this page</span></div>
          <div className="state-line"><span className={`dot ${siteOn ? '' : 'off'}`} />
            <span>{!s.globalEnabled ? 'Ad blocker is off everywhere' : siteOn ? `Protection is on for ${s.host}` : `Protection is paused for ${s.host}`}</span></div>
          <label className="row clickable" style={{ cursor: 'pointer' }}>
            <span className="grow">Block on {s.host}<span className="sub" style={{ display: 'block' }}>{siteOn ? 'Turn off if the site does not work correctly.' : 'The page reloads when you turn this on.'}</span></span>
            <input type="checkbox" className="switch" checked={siteOn} disabled={!s.globalEnabled} onChange={async (e) => { await invoke('adblock:setSite', s.host, e.target.checked); reload() }} />
          </label>
        </>
      )}
      <div className="row"><span className="grow muted">{s.blockedSession.toLocaleString()} blocked this session</span>
        <label className="row" style={{ padding: 0, minHeight: 0 }}><span className="muted">All sites</span><input type="checkbox" className="switch" checked={s.globalEnabled} onChange={(e) => invoke('adblock:setGlobal', e.target.checked)} /></label></div>
      <div className="p-sep" />
      <button className="menu-item" onClick={() => setShowList((v) => !v)} aria-expanded={showList}><Icon name={showList ? 'chevronDown' : 'chevron'} size={15} />Blocked requests on this page<span className="key">{s.recent.length}</span></button>
      {showList && (s.recent.length ? (
        <ul className="req-list">{s.recent.map((r, i) => <li key={i}><div className="u">{r.url}</div><div className="faint">{r.type}{r.filter ? ` · ${r.filter}` : ''}</div></li>)}</ul>
      ) : <div className="p-body faint">Nothing has been blocked on this page.</div>)}
      <button className="menu-item" onClick={() => open('lumen://adblock', close)}><Icon name="tools" size={15} />Filter lists and rules</button>
    </>
  )
}

// ---------------------------------------------------------------- site information
const PERMS: { kind: PermissionKind; label: string; icon: IconName }[] = [
  { kind: 'media', label: 'Camera and microphone', icon: 'camera' }, { kind: 'geolocation', label: 'Location', icon: 'location' }, { kind: 'notifications', label: 'Notifications', icon: 'bell' },
  { kind: 'popups', label: 'Pop-ups', icon: 'popup' }, { kind: 'clipboard-read', label: 'Clipboard', icon: 'copy' }, { kind: 'screen', label: 'Screen sharing', icon: 'window' },
]

export function SiteInfoPanel({ tabId, close }: { tabId: number; close: () => void }) {
  const [info, reload] = useRemote<SiteInfo | null>('site:info', [tabId], ['permissions:changed'])
  if (!info) return null
  const text = { secure: 'Connection is secure', insecure: 'Connection is not secure', internal: 'This is a Lumen page', file: 'This is a file on your computer', error: 'This page failed to load' }[info.security]
  const web = /^https?:/.test(info.url)
  return (
    <>
      <div className="p-head"><Icon name={info.security === 'secure' ? 'lock' : info.security === 'insecure' || info.security === 'error' ? 'warning' : 'info'} size={20} /><h2>{info.host || 'Lumen'}</h2></div>
      <div className="p-body">
        <div className={info.security === 'insecure' || info.security === 'error' ? '' : 'muted'} style={info.security === 'insecure' ? { color: 'var(--danger)' } : undefined}>{text}</div>
        {info.security === 'insecure' && <div className="faint" style={{ marginTop: 4 }}>Do not enter passwords or card numbers on this site. Others on the network can read what you send.</div>}
      </div>
      {web && (
        <>
          <div className="p-sep" />
          {PERMS.map((p) => (
            <div className="row" key={p.kind}><Icon name={p.icon} size={16} /><span className="grow">{p.label}</span>
              <select className="perm-select" aria-label={p.label} value={info.permissions[p.kind] ?? 'ask'} onChange={async (e) => { await invoke('site:setPermission', info.origin, p.kind, e.target.value as PermissionValue); reload() }}>
                <option value="ask">Ask</option><option value="allow">Allow</option><option value="block">Block</option></select></div>
          ))}
          <div className="p-sep" />
          <div className="row"><Icon name="key" size={16} /><span className="grow">Cookies in use<span className="sub" style={{ display: 'block' }}>{info.cookieCount} for this site</span></span>
            <button className="btn" disabled={!info.cookieCount} onClick={async () => { await invoke('site:clearCookies', info.url); reload() }}>Clear</button></div>
          <button className="menu-item" onClick={() => open('lumen://settings/#permissions', close)}><Icon name="settings" size={15} />All site settings</button>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------- extensions menu
export function ExtensionsPanel({ close }: { close: () => void }) {
  const [list] = useRemote<ExtensionInfo[]>('extensions:list', [], ['extensions:changed', 'settings:changed'], [])
  const act = async (e: ExtensionInfo, rect: DOMRect) => {
    const partition = await invoke('extensions:partition')
    close()
    window.browserAction?.activate(partition, { eventType: 'click', extensionId: e.id, tabId: undefined, alignment: 'bottom right', anchorRect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } })
  }
  return (
    <>
      <div className="p-head"><h2>Extensions</h2></div>
      {(list ?? []).length === 0 && <div className="p-body muted">No extensions installed. Add one from the Chrome Web Store or load an unpacked folder.</div>}
      {(list ?? []).map((e) => (
        <div className="row clickable" key={e.id} style={{ opacity: e.enabled ? 1 : 0.55 }}>
          {e.iconUrl ? <img className="ext-ic" src={e.iconUrl} alt="" /> : <span className="ext-ic" style={{ background: 'var(--bg-hover)' }} />}
          <button className="grow" style={{ background: 'none', border: 0, textAlign: 'left', padding: 0 }} disabled={!e.enabled || !e.hasAction} onClick={(ev) => act(e, ev.currentTarget.getBoundingClientRect())}>
            <div className="ellipsis">{e.name}</div><div className="sub">{e.enabled ? (e.hasAction ? 'Click to open' : 'No toolbar button') : 'Disabled'}</div></button>
          <span className={`chip ${e.compat === 'full' ? 'ok' : e.compat === 'partial' ? 'warn' : 'bad'}`} title="Compatibility with Lumen">{e.compat}</span>
          <button className={`icon-btn ${e.pinned ? 'on' : ''}`} aria-label={e.pinned ? 'Unpin from toolbar' : 'Pin to toolbar'} title={e.pinned ? 'Unpin from toolbar' : 'Pin to toolbar'} disabled={!e.hasAction} onClick={() => invoke('extensions:pin', e.id, !e.pinned)}><Icon name="pin" size={16} /></button>
        </div>
      ))}
      <div className="p-sep" />
      <button className="menu-item" onClick={() => open('lumen://extensions', close)}><Icon name="settings" size={15} />Manage extensions</button>
      <button className="menu-item" onClick={() => { invoke('extensions:webstore'); close() }}><Icon name="external" size={15} />Open Chrome Web Store</button>
    </>
  )
}

// ---------------------------------------------------------------- downloads popup
export function DownloadsPanel({ close }: { close: () => void }) {
  const [list] = useRemote<DownloadRecord[]>('downloads:list', [], ['downloads:changed'], [])
  const rows = (list ?? []).slice(0, 6)
  return (
    <>
      <div className="p-head"><h2>Downloads</h2></div>
      {rows.length === 0 && <div className="p-body muted">Files you download appear here.</div>}
      {rows.map((d) => <DownloadRow key={d.id} d={d} compact />)}
      <div className="p-sep" />
      <button className="menu-item" onClick={() => open('lumen://downloads', close)}><Icon name="download" size={15} />Show all downloads<span className="key">Ctrl+J</span></button>
    </>
  )
}

export function DownloadRow({ d, compact }: { d: DownloadRecord; compact?: boolean }) {
  const pct = d.totalBytes > 0 ? Math.min(100, (d.receivedBytes / d.totalBytes) * 100) : 0
  const live = d.status === 'progressing' || d.status === 'paused'
  const detail = live
    ? `${formatBytes(d.receivedBytes)}${d.totalBytes ? ` of ${formatBytes(d.totalBytes)}` : ''}${d.status === 'paused' ? ' · paused' : d.bytesPerSecond ? ` · ${formatBytes(d.bytesPerSecond)}/s · ${formatEta(d.etaSeconds)}` : ''}`
    : d.status === 'completed' ? (d.exists === false ? 'File was moved or deleted' : formatBytes(d.totalBytes)) : d.status === 'cancelled' ? 'Cancelled' : d.error ?? 'Failed'
  return (
    <div className="row" style={{ alignItems: 'flex-start', paddingTop: 8, paddingBottom: 8 }}>
      <Icon name="download" size={18} />
      <div className="grow">
        <div className="ellipsis" title={d.savePath} style={{ cursor: d.status === 'completed' && d.exists !== false ? 'pointer' : undefined }} onClick={() => d.status === 'completed' && invoke('downloads:open', d.id)}>{d.filename}</div>
        <div className="sub" style={d.status === 'interrupted' ? { color: 'var(--danger)' } : undefined}>{detail}</div>
        {live && <div className="dl-bar"><i style={{ width: `${d.totalBytes ? pct : 100}%`, opacity: d.totalBytes ? 1 : 0.4 }} /></div>}
      </div>
      {live && d.canResume !== undefined && <button className="icon-btn" title={d.status === 'paused' ? 'Resume' : 'Pause'} aria-label={d.status === 'paused' ? 'Resume' : 'Pause'} onClick={() => invoke(d.status === 'paused' ? 'downloads:resume' : 'downloads:pause', d.id)}><Icon name={d.status === 'paused' ? 'forward' : 'stop'} size={15} /></button>}
      {live && <button className="icon-btn" title="Cancel" aria-label="Cancel download" onClick={() => invoke('downloads:cancel', d.id)}><Icon name="close" size={15} /></button>}
      {!live && d.status === 'completed' && d.exists !== false && <button className="icon-btn" title="Show in folder" aria-label="Show in folder" onClick={() => invoke('downloads:show', d.id)}><Icon name="folder" size={15} /></button>}
      {!live && !compact && <button className="icon-btn" title="Remove from list" aria-label="Remove from list" onClick={() => invoke('downloads:remove', d.id)}><Icon name="trash" size={15} /></button>}
    </div>
  )
}

// ---------------------------------------------------------------- profiles
const PROFILE_COLORS = ['#4f7cff', '#e5484d', '#2fa36b', '#e0a030', '#9b5de5', '#00a5b5', '#e0568c']
export function ProfilesPanel({ close }: { close: () => void }) {
  const [data, reload] = useRemote<{ profiles: ProfileInfo[]; lastUsed: string }>('profiles:list', [])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(PROFILE_COLORS[2])
  if (!data) return null
  return (
    <>
      <div className="p-head"><h2>Profiles</h2></div>
      {data.profiles.map((p) => (
        <div className="row clickable" key={p.id}>
          <button className="row grow" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }} onClick={() => { invoke('profiles:open', p.id); close() }}>
            <span className="avatar" style={{ background: p.color, width: 26, height: 26, display: 'grid', placeItems: 'center', borderRadius: '50%', color: '#fff', fontWeight: 700 }}>{p.name.charAt(0).toUpperCase()}</span>
            <span className="grow ellipsis">{p.name}</span></button>
          {p.id !== 'default' && <button className="icon-btn" aria-label={`Delete profile ${p.name}`} title="Delete profile" onClick={async () => { await invoke('profiles:remove', p.id); reload() }}><Icon name="trash" size={15} /></button>}
        </div>
      ))}
      {adding ? (
        <form className="p-body" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await invoke('profiles:add', name, color); setName(''); setAdding(false); reload() }}>
          <input className="field" autoFocus placeholder="Profile name" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
          <div className="color-row">{PROFILE_COLORS.map((c) => <button type="button" key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => setColor(c)} />)}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" disabled={!name.trim()}>Add profile</button></div>
        </form>
      ) : <button className="menu-item" onClick={() => setAdding(true)}><Icon name="plus" size={15} />Add profile</button>}
      <div className="p-sep" />
      <button className="menu-item" onClick={() => { invoke('cmd', 'win.private'); close() }}><Icon name="incognito" size={15} />New private window<span className="key">Ctrl+Shift+N</span></button>
    </>
  )
}

// ---------------------------------------------------------------- main menu and bookmark folders
export function MainMenu({ mode, folderId, close }: { mode?: string; folderId?: string; close: () => void }) {
  if (mode === 'bookmark-folder') return <FolderMenu folderId={folderId ?? 'bar'} close={close} />
  const cmd = (c: string) => () => { invoke('cmd', c); close() }
  const item = (icon: IconName, label: string, onClick: () => void, key?: string) => <button className="menu-item" onClick={onClick}><Icon name={icon} size={16} />{label}{key && <span className="key">{key}</span>}</button>
  return (
    <>
      <div style={{ paddingTop: 6 }} />
      {item('plus', 'New tab', cmd('tab.new'), 'Ctrl+T')}
      {item('window', 'New window', cmd('win.new'), 'Ctrl+N')}
      {item('incognito', 'New private window', cmd('win.private'), 'Ctrl+Shift+N')}
      <div className="p-sep" />
      {item('history', 'History', cmd('open.history'), 'Ctrl+H')}
      {item('download', 'Downloads', cmd('open.downloads'), 'Ctrl+J')}
      {item('bookmark', 'Bookmarks', cmd('open.bookmarks'), 'Ctrl+Shift+O')}
      {item('bookmark', 'Show bookmarks bar', cmd('view.bookmarksBar'), 'Ctrl+Shift+B')}
      {item('puzzle', 'Extensions', cmd('open.extensions'), 'Ctrl+Shift+X')}
      {item('key', 'Passwords', () => open('lumen://passwords', close))}
      <div className="p-sep" />
      <ZoomRow />
      <div className="p-sep" />
      {item('find', 'Find in page', cmd('page.find'), 'Ctrl+F')}
      {item('print', 'Print', cmd('page.print'), 'Ctrl+P')}
      {item('tools', 'Developer tools', cmd('page.devtools'), 'F12')}
      {item('window', 'Fullscreen', cmd('view.fullscreen'), 'F11')}
      <div className="p-sep" />
      {item('shield', 'Ad blocker', () => open('lumen://adblock', close))}
      {item('settings', 'Settings', cmd('open.settings'), 'Ctrl+,')}
      <div style={{ paddingBottom: 6 }} />
    </>
  )
}

function ZoomRow() {
  return (
    <div className="row"><Icon name="zoomIn" size={16} /><span className="grow">Zoom</span>
      <button className="btn" aria-label="Zoom out" onClick={() => invoke('cmd', 'page.zoomOut')}>-</button>
      <button className="btn" aria-label="Reset zoom" onClick={() => invoke('cmd', 'page.zoomReset')}>Reset</button>
      <button className="btn" aria-label="Zoom in" onClick={() => invoke('cmd', 'page.zoomIn')}>+</button></div>
  )
}

function FolderMenu({ folderId, close }: { folderId: string; close: () => void }) {
  const [all] = useRemote<Bookmark[]>('bookmarks:list', [], ['bookmarks:changed'], [])
  const [path, setPath] = useState<string[]>([folderId])
  const cur = path[path.length - 1]
  const kids = useMemo(() => (all ?? []).filter((b) => b.parentId === cur).sort((a, b) => a.index - b.index), [all, cur])
  const title = (all ?? []).find((b) => b.id === cur)?.title ?? 'Bookmarks'
  return (
    <>
      <div className="p-head">{path.length > 1 && <button className="icon-btn" aria-label="Back" onClick={() => setPath((p) => p.slice(0, -1))}><Icon name="back" size={16} /></button>}<h2>{title}</h2></div>
      {kids.length === 0 && <div className="p-body muted">This folder is empty.</div>}
      {kids.map((b) => b.type === 'folder'
        ? <button key={b.id} className="menu-item" onClick={() => setPath((p) => [...p, b.id])}><Icon name="folder" size={16} />{b.title}<span className="key"><Icon name="chevron" size={14} /></span></button>
        : <button key={b.id} className="menu-item" title={b.url} onClick={() => { invoke('nav:go', b.url); close() }}><Icon name="globe" size={16} /><span className="ellipsis">{b.title}</span></button>)}
      <div className="p-sep" />
      <button className="menu-item" onClick={() => open('lumen://bookmarks', close)}><Icon name="bookmark" size={15} />Open bookmark manager</button>
    </>
  )
}

// ---------------------------------------------------------------- bookmark editor
export function BookmarkEdit({ id, close }: { id: string; close: () => void }) {
  const [all] = useRemote<Bookmark[]>('bookmarks:list', [], [], [])
  const bm = (all ?? []).find((b) => b.id === id)
  const [title, setTitle] = useState<string | null>(null)
  const folders = useMemo(() => {
    const out: { id: string; label: string }[] = []
    const walk = (pid: string | null, depth: number) => {
      for (const f of (all ?? []).filter((b) => b.type === 'folder' && b.parentId === pid).sort((a, b) => a.index - b.index)) {
        if (f.id !== id) { out.push({ id: f.id, label: `${'  '.repeat(depth)}${f.title}` }); walk(f.id, depth + 1) }
      }
    }
    walk(null, 0)
    return out
  }, [all, id])
  if (!bm) return null
  const t = title ?? bm.title
  return (
    <>
      <div className="p-head"><h2>{bm.type === 'folder' ? 'Edit folder' : 'Bookmark'}</h2></div>
      <div className="p-body" style={{ display: 'grid', gap: 8 }}>
        <label>Name<input className="field" value={t} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { invoke('bookmarks:update', id, { title: t }); close() } }} autoFocus /></label>
        <label>Folder<select className="field" value={bm.parentId ?? 'bar'} onChange={(e) => invoke('bookmarks:update', id, { parentId: e.target.value })}>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.label.replace(/ /g, ' ')}</option>)}</select></label>
      </div>
      <div className="p-foot"><button className="btn danger" onClick={async () => { await invoke('bookmarks:remove', id); close() }}>Remove</button>
        <button className="btn primary" onClick={async () => { if (t.trim() && t !== bm.title) await invoke('bookmarks:update', id, { title: t.trim() }); close() }}>Done</button></div>
    </>
  )
}

// ---------------------------------------------------------------- tab group editor
const GROUP_COLORS = ['#8ab4f8', '#f28b82', '#fdd663', '#81c995', '#ff8bcb', '#78d9ec', '#c58af9', '#fcad70']
export function GroupEdit({ group, close }: { group: TabGroup; close: () => void }) {
  const [name, setName] = useState(group.name)
  const [color, setColor] = useState(group.color)
  const save = (patch: { name?: string; color?: string }) => invoke('group:update', group.id, patch)
  return (
    <>
      <div className="p-head"><h2>Tab group</h2></div>
      <div className="p-body">
        <input className="field" autoFocus placeholder="Group name" value={name} maxLength={40} onChange={(e) => { setName(e.target.value); save({ name: e.target.value }) }} onKeyDown={(e) => e.key === 'Enter' && close()} />
        <div className="color-row" role="radiogroup" aria-label="Group colour">{GROUP_COLORS.map((c) => <button key={c} role="radio" aria-checked={c === color} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => { setColor(c); save({ color: c }) }} />)}</div>
      </div>
      <div className="p-sep" />
      <button className="menu-item" onClick={() => { invoke('group:ungroup', group.id); close() }}><Icon name="close" size={15} />Ungroup</button>
      <button className="menu-item" onClick={() => { invoke('group:close', group.id); close() }}><Icon name="trash" size={15} />Close group</button>
    </>
  )
}

// ---------------------------------------------------------------- prompts
export function PromptPanel({ request }: { request: PromptRequest }) {
  const [remember, setRemember] = useState(true)
  const [pick, setPick] = useState<string | null>(null)
  const answer = (v: unknown) => invoke('overlay:result', request.id, v)
  let host = request.origin
  try { host = new URL(request.origin).host || request.origin } catch { /* keep raw */ }

  if (request.kind === 'password') {
    return (
      <>
        <div className="p-head"><span className="prompt-icon"><Icon name="key" size={19} /></span><h2>{request.update ? 'Update password?' : 'Save password?'}</h2></div>
        <div className="p-body">{request.username ? <>For <b>{request.username}</b> on {host}.</> : <>For {host}.</>} It is stored encrypted by your operating system.</div>
        <div className="p-foot"><button className="btn" onClick={() => answer(false)}>Not now</button><button className="btn primary" autoFocus onClick={() => answer(true)}>{request.update ? 'Update' : 'Save'}</button></div>
      </>
    )
  }
  if (request.kind === 'screenshare') {
    return (
      <>
        <div className="p-head"><span className="prompt-icon"><Icon name="window" size={19} /></span><h2>{host} wants to share your screen</h2></div>
        <div className="p-body"><div className="src-grid">{request.sources.map((s) => <button key={s.id} className={`src ${pick === s.id ? 'on' : ''}`} onClick={() => setPick(s.id)} onDoubleClick={() => answer(s.id)}><img src={s.thumbnail} alt="" /><span className="ellipsis">{s.name}</span></button>)}</div></div>
        <div className="p-foot"><button className="btn" onClick={() => answer(null)}>Cancel</button><button className="btn primary" disabled={!pick} onClick={() => answer(pick)}>Share</button></div>
      </>
    )
  }
  return (
    <>
      <div className="p-head"><span className="prompt-icon"><Icon name={request.permission === 'media' ? 'camera' : request.permission === 'geolocation' ? 'location' : request.permission === 'notifications' ? 'bell' : 'info'} size={19} /></span><h2>{host} wants to {request.label}</h2></div>
      <div className="p-body"><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember my choice for this site</label></div>
      <div className="p-foot"><button className="btn" onClick={() => answer({ allow: false, remember })}>Block</button><button className="btn primary" autoFocus onClick={() => answer({ allow: true, remember })}>Allow</button></div>
    </>
  )
}

// ---------------------------------------------------------------- address bar suggestions
export function Suggestions({ rows, selected }: { rows: SuggestionItem[]; selected: number }) {
  const icon = (t: SuggestionItem['type']): IconName => (t === 'history' ? 'history' : t === 'bookmark' ? 'star' : 'search')
  return (
    <div className="sugg" role="listbox">
      {rows.map((r, i) => (
        <div key={i} role="option" aria-selected={i === selected} className={`sugg-row ${i === selected ? 'sel' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); invoke('cmd', 'suggestion.pick', r.url ?? r.text) }}>
          <span className="ico"><Icon name={icon(r.type)} size={15} /></span>
          <span className="t ellipsis">{r.type === 'search' ? <>{r.text}<span className="faint"> - search</span></> : r.text}</span>
          {r.url && <span className="u ellipsis">{r.url.replace(/^https?:\/\/(www\.)?/, '')}</span>}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- find in page
export function FindBar({ close }: { close: () => void }) {
  const [q, setQ] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [res, setRes] = useState<{ matches: number; activeMatchOrdinal: number } | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  useEvent('find:result', (r: { matches: number; activeMatchOrdinal: number }) => setRes(r))
  const start = useCallback((text: string, opts: { forward?: boolean; findNext?: boolean; matchCase?: boolean } = {}) => { invoke('find:start', text, { matchCase, ...opts }) }, [matchCase])
  const finish = () => { invoke('find:stop'); close() }
  return (
    <div className="findbar">
      <Icon name="find" size={16} />
      <input ref={ref} value={q} placeholder="Find in page" aria-label="Find in page" onChange={(e) => { setQ(e.target.value); setRes(null); start(e.target.value) }}
        onKeyDown={(e) => { if (e.key === 'Enter') start(q, { forward: !e.shiftKey, findNext: true }); else if (e.key === 'Escape') finish() }} />
      <span className="count">{q ? (res ? (res.matches ? `${res.activeMatchOrdinal}/${res.matches}` : 'No matches') : '') : ''}</span>
      <button className={`icon-btn ${matchCase ? 'on' : ''}`} title="Match case" aria-label="Match case" aria-pressed={matchCase} onClick={() => { setMatchCase(!matchCase); if (q) invoke('find:start', q, { matchCase: !matchCase }) }}><b style={{ fontSize: 12 }}>Aa</b></button>
      <button className="icon-btn" title="Previous (Shift+Enter)" aria-label="Previous match" onClick={() => start(q, { forward: false, findNext: true })}><Icon name="up" size={16} /></button>
      <button className="icon-btn" title="Next (Enter)" aria-label="Next match" onClick={() => start(q, { forward: true, findNext: true })}><Icon name="chevronDown" size={16} /></button>
      <button className="icon-btn" title="Close" aria-label="Close find bar" onClick={finish}><Icon name="close" size={16} /></button>
    </div>
  )
}
