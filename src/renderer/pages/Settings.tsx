import { useEffect, useRef, useState } from 'react'
import { formatBytes, invoke, useRemote, useSettings } from '../common/api.ts'
import { Icon, type IconName } from '../common/icons.tsx'
import { Section, SettingRow, Toggle, guard, toast } from './shared.tsx'
import { AdblockSummary } from './Adblock.tsx'
import { DEFAULT_SHORTCUTS, SHORTCUT_LABELS } from '../../shared/defaults.ts'
import { acceleratorFromEvent, formatAccelerator } from '../../shared/shortcuts.ts'
import type { AppInfo, PermissionKind, PermissionValue, Settings } from '../../shared/types.ts'

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'settings' }, { id: 'appearance', label: 'Appearance', icon: 'eye' }, { id: 'privacy', label: 'Privacy and security', icon: 'lock' },
  { id: 'adblock', label: 'Ad blocker', icon: 'shield' }, { id: 'extensions', label: 'Extensions', icon: 'puzzle' }, { id: 'downloads', label: 'Downloads', icon: 'download' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'tools' }, { id: 'advanced', label: 'Advanced', icon: 'tools' }, { id: 'about', label: 'About Lumen', icon: 'info' },
]
const ACCENTS = ['#4f7cff', '#7a5af8', '#e5484d', '#e0568c', '#f08c00', '#2fa36b', '#00a5b5', '#6b7280']
const PERM_LABELS: Record<PermissionKind, string> = { media: 'Camera and microphone', geolocation: 'Location', notifications: 'Notifications', popups: 'Pop-ups', 'clipboard-read': 'Clipboard', fullscreen: 'Fullscreen', midi: 'MIDI devices', openExternal: 'Open external apps', screen: 'Screen sharing' }

export function SettingsPage() {
  const [s, update] = useSettings()
  const [section, setSection] = useState(() => location.hash.replace('#', '') || 'general')
  const [clearOpen, setClearOpen] = useState(location.hash === '#clear')
  useEffect(() => {
    const h = () => { const id = location.hash.replace('#', ''); if (id === 'clear') setClearOpen(true); else if (id) setSection(id === 'permissions' ? 'privacy' : id) }
    window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h)
  }, [])
  if (!s) return null
  const set = async (patch: any) => { const r = await guard(update(patch)); if (r?.restartRequired) toast('Restart Lumen to apply this change.') }
  return (
    <div className="page">
      <header className="page-head" style={{ maxWidth: 1060 }}><h1><Icon name="settings" size={22} />Settings</h1></header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((x) => <a key={x.id} href={`#${x.id}`} className={section === x.id ? 'on' : ''} onClick={(e) => { e.preventDefault(); setSection(x.id); history.replaceState(null, '', `#${x.id}`) }}><Icon name={x.icon} size={16} />{x.label}</a>)}
        </nav>
        <div>
          {section === 'general' && <General s={s} set={set} />}
          {section === 'appearance' && <Appearance s={s} set={set} />}
          {section === 'privacy' && <Privacy s={s} set={set} onClear={() => setClearOpen(true)} />}
          {section === 'adblock' && <Section title="Ad blocker"><AdblockSummary /></Section>}
          {section === 'extensions' && <ExtensionsSection s={s} set={set} />}
          {section === 'downloads' && <Downloads s={s} set={set} />}
          {section === 'shortcuts' && <Shortcuts s={s} set={set} />}
          {section === 'advanced' && <Advanced s={s} set={set} />}
          {section === 'about' && <About />}
        </div>
      </div>
      {clearOpen && <ClearDataDialog onClose={() => { setClearOpen(false); if (location.hash === '#clear') history.replaceState(null, '', '#privacy') }} />}
    </div>
  )
}

type P = { s: Settings; set: (patch: any) => Promise<void> }

function General({ s, set }: P) {
  const [engines] = useRemote<{ id: string; name: string }[]>('app:searchEngines', [], [], [])
  const [isDefault, setIsDefault] = useState<boolean | null>(null)
  useEffect(() => { invoke('app:isDefaultBrowser').then(setIsDefault) }, [])
  const [home, setHome] = useState(s.homepage)
  return (
    <>
      <Section title="On startup">
        <SettingRow label="When Lumen starts">
          <select className="field" value={s.startup} onChange={(e) => set({ startup: e.target.value })}>
            <option value="restore">Continue where I left off</option><option value="newtab">Open the new tab page</option><option value="home">Open the home page</option></select></SettingRow>
        <SettingRow label="Home page" hint="Used by the Home button and when startup is set to open the home page.">
          <input className="field" value={home} onChange={(e) => setHome(e.target.value)} onBlur={() => home !== s.homepage && set({ homepage: home.trim() || 'lumen://newtab' })} placeholder="lumen://newtab" /></SettingRow>
        <SettingRow label="New tabs open" hint="Pages that open links in a new tab are not affected."><select className="field" value={s.newTabOpens} onChange={(e) => set({ newTabOpens: e.target.value as 'newtab' | 'home' })}><option value="home">My homepage</option><option value="newtab">The new tab page</option></select></SettingRow>
      </Section>
      <Section title="Search">
        <SettingRow label="Default search engine" hint="Used when you type a search in the address bar.">
          <select className="field" value={s.searchEngine} onChange={(e) => set({ searchEngine: e.target.value })}>{(engines ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}<option value="custom">Custom...</option></select></SettingRow>
        {s.searchEngine === 'custom' && <SettingRow label="Custom search URL" hint="Use %s where the search words go." stack>
          <input className="field" defaultValue={s.customSearchUrl} onBlur={(e) => set({ customSearchUrl: e.target.value })} placeholder="https://example.com/search?q=%s" /></SettingRow>}
        <SettingRow label="Search suggestions" hint="Sends what you type in the address bar to the search engine to get suggestions. History suggestions stay on your computer."><Toggle label="Search suggestions" checked={s.searchSuggestions} onChange={(v) => set({ searchSuggestions: v })} /></SettingRow>
      </Section>
      <Section title="Default browser">
        <SettingRow label={isDefault ? 'Lumen is your default browser' : 'Lumen is not your default browser'} hint="Windows opens its Default apps settings, where you pick Lumen for web links.">
          <button className="btn" onClick={async () => { const r = await guard(invoke('app:setDefaultBrowser')); if (r) setIsDefault(r.isDefault) }}>Make default</button></SettingRow>
      </Section>
    </>
  )
}

function Appearance({ s, set }: P) {
  return (
    <>
      <Section title="Theme">
        <SettingRow label="Colour mode"><select className="field" value={s.theme} onChange={(e) => set({ theme: e.target.value })}><option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option></select></SettingRow>
        <SettingRow label="Accent colour" hint="Used for focus rings, the active toggle and highlights." stack>
          <div className="color-row" role="radiogroup" aria-label="Accent colour" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {ACCENTS.map((c) => <button key={c} role="radio" aria-checked={s.accent === c} className={`swatch ${s.accent === c ? 'on' : ''}`} style={{ background: c, width: 28, height: 28 }} aria-label={`Accent ${c}`} onClick={() => set({ accent: c })} />)}
            <input type="color" aria-label="Custom accent colour" value={s.accent} onChange={(e) => set({ accent: e.target.value })} style={{ width: 34, height: 28, border: 0, background: 'none', padding: 0 }} />
          </div></SettingRow>
      </Section>
      <Section title="Toolbar">
        <SettingRow label="Show bookmarks bar" hint="Ctrl+Shift+B"><Toggle label="Show bookmarks bar" checked={s.showBookmarksBar} onChange={(v) => set({ showBookmarksBar: v })} /></SettingRow>
        {([['home', 'Home button'], ['bookmark', 'Bookmark star'], ['adblock', 'Ad blocker shield'], ['extensions', 'Extensions menu'], ['downloads', 'Downloads button'], ['sidePanel', 'Side panel button'], ['profile', 'Profile button']] as const).map(([k, label]) => (
          <SettingRow key={k} label={label}><Toggle label={label} checked={s.toolbar[k]} onChange={(v) => set({ toolbar: { [k]: v } })} /></SettingRow>))}
        <SettingRow label="Hide extension buttons" hint="Hides pinned extensions and the extensions menu from the toolbar. Extensions keep running."><Toggle label="Hide extension buttons" checked={s.hideExtensions} onChange={(v) => set({ hideExtensions: v })} /></SettingRow>
      </Section>
    </>
  )
}

function Privacy({ s, set, onClear }: P & { onClear: () => void }) {
  const [perms, reload] = useRemote<Record<string, Partial<Record<PermissionKind, PermissionValue>>>>('permissions:list', [], ['permissions:changed'], {})
  const [vaultOk] = useRemote<boolean>('passwords:available', [])
  const origins = Object.keys(perms ?? {}).sort()
  return (
    <>
      <Section title="Protection">
        <SettingRow label="Tracking protection" hint="Blocks trackers using the privacy filter lists and sends the Global Privacy Control signal."><Toggle label="Tracking protection" checked={s.trackingProtection} onChange={(v) => set({ trackingProtection: v })} /></SettingRow>
        <SettingRow label="Block third-party cookies" hint="Stops sites embedded in other pages from storing or reading cookies. Some sign-in and payment flows need them."><Toggle label="Block third-party cookies" checked={s.blockThirdPartyCookies} onChange={(v) => set({ blockThirdPartyCookies: v })} /></SettingRow>
        <SettingRow label='Send a "Do Not Track" request' hint="Most sites ignore it."><Toggle label="Do Not Track" checked={s.sendDoNotTrack} onChange={(v) => set({ sendDoNotTrack: v })} /></SettingRow>
        <SettingRow label="Upgrade to HTTPS automatically" hint="Tries https:// first when you open an http:// address and falls back to http:// if the site has no secure version."><Toggle label="Upgrade to HTTPS" checked={s.httpsUpgrade} onChange={(v) => set({ httpsUpgrade: v })} /></SettingRow>
      </Section>
      <CookieManager />
      <Section title="History and passwords">
        <SettingRow label="Save browsing history" hint="Private windows never save history."><Toggle label="Save browsing history" checked={s.historyEnabled} onChange={(v) => set({ historyEnabled: v })} /></SettingRow>
        <SettingRow label="Offer to save passwords" hint={vaultOk === false ? 'Secure storage is not available on this system, so passwords cannot be saved.' : 'Passwords are encrypted with your operating system account (Windows DPAPI).'}><Toggle label="Offer to save passwords" checked={s.offerToSavePasswords && vaultOk !== false} disabled={vaultOk === false} onChange={(v) => set({ offerToSavePasswords: v })} /></SettingRow>
        <SettingRow label="Saved passwords"><button className="btn" onClick={() => invoke('nav:go', 'lumen://passwords', { newTab: true })}>Manage passwords</button></SettingRow>
        <SettingRow label="Clear browsing data" hint="History, downloads list, cookies, cache, passwords and site settings."><button className="btn" onClick={onClear}>Clear data...</button></SettingRow>
      </Section>
      <Section title="Default site permissions" description="Applies to sites you have not set individually. Block means the site is never asked.">
        {(Object.keys(PERM_LABELS) as PermissionKind[]).filter((k) => k !== 'fullscreen').map((k) => (
          <SettingRow key={k} label={PERM_LABELS[k]}>
            <select className="field" aria-label={PERM_LABELS[k]} value={s.permissionDefaults[k]} onChange={(e) => set({ permissionDefaults: { [k]: e.target.value } })}>
              <option value="ask">Ask</option><option value="allow">Allow</option><option value="block">Block</option></select></SettingRow>))}
      </Section>
      <Section title="Site-specific permissions" id="permissions">
        {origins.length === 0 && <SettingRow label="No saved site permissions" hint="Choices you remember in permission prompts appear here." />}
        {origins.map((o) => (
          <SettingRow key={o} label={o} hint={Object.entries(perms![o]).map(([k, v]) => `${PERM_LABELS[k as PermissionKind] ?? k}: ${v}`).join(', ')}>
            <button className="btn" onClick={async () => { await invoke('permissions:reset', o); reload() }}>Reset</button></SettingRow>))}
      </Section>
    </>
  )
}

function ExtensionsSection({ s, set }: P) {
  return (
    <Section title="Extensions">
      <SettingRow label="Manage extensions" hint="Install, enable, remove, and see which Chrome APIs each extension needs."><button className="btn primary" onClick={() => invoke('nav:go', 'lumen://extensions', { newTab: true })}>Open extensions</button></SettingRow>
      <SettingRow label="Hide extension buttons in the toolbar"><Toggle label="Hide extension buttons" checked={s.hideExtensions} onChange={(v) => set({ hideExtensions: v })} /></SettingRow>
    </Section>
  )
}

function Downloads({ s, set }: P) {
  return (
    <Section title="Downloads">
      <SettingRow label="Save files to" hint={s.downloadDir || 'Your Windows Downloads folder'}>
        <button className="btn" onClick={async () => { const d = await guard(invoke('settings:chooseDownloadDir')); if (d) set({ downloadDir: d }) }}>Change...</button>
        {s.downloadDir && <button className="btn quiet" onClick={() => set({ downloadDir: '' })}>Use default</button>}</SettingRow>
      <SettingRow label="Ask where to save each file"><Toggle label="Ask where to save each file" checked={s.askDownloadLocation} onChange={(v) => set({ askDownloadLocation: v })} /></SettingRow>
    </Section>
  )
}

function Shortcuts({ s, set }: P) {
  const [rec, setRec] = useState<string | null>(null)
  const primary = Object.keys(SHORTCUT_LABELS)
  const current = (id: string) => (s.shortcuts[id] !== undefined ? s.shortcuts[id] : DEFAULT_SHORTCUTS[id])
  const conflict = (id: string, acc: string) => Object.keys(DEFAULT_SHORTCUTS).find((o) => o !== id && current(o) === acc)
  useEffect(() => {
    if (!rec) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setRec(null); return }
      const acc = acceleratorFromEvent(e)
      if (!acc) return
      if (!/^(F\d+)$/.test(acc) && !e.ctrlKey && !e.altKey && !e.metaKey) { toast('Use Ctrl or Alt with a key, or an F-key.', 'error'); return }
      const c = conflict(rec, acc)
      if (c) { toast(`Already used by "${SHORTCUT_LABELS[c] ?? c}". Change that one first.`, 'error'); return }
      guard(invoke('settings:setShortcut', rec, acc)); setRec(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  return (
    <Section title="Keyboard shortcuts" description="Select a shortcut, then press the new keys. Escape cancels.">
      {primary.map((id) => (
        <SettingRow key={id} label={SHORTCUT_LABELS[id]}>
          <button className={`kbd ${rec === id ? 'rec' : ''}`} onClick={() => setRec(rec === id ? null : id)} aria-label={`Change shortcut for ${SHORTCUT_LABELS[id]}`}>{rec === id ? 'Press keys...' : current(id) ? formatAccelerator(current(id)) : 'Not set'}</button>
          {s.shortcuts[id] !== undefined && <button className="btn quiet" onClick={() => guard(invoke('settings:setShortcut', id, null))}>Reset</button>}
        </SettingRow>))}
    </Section>
  )
}

function Advanced({ s, set }: P) {
  const [usage, reload] = useRemote<{ cacheBytes: number; cookieCount: number }>('data:usage', [])
  const [info] = useRemote<AppInfo>('app:info', [])
  return (
    <>
      <Section title="Performance">
        <SettingRow label="Report as Google Chrome to websites" hint="Needed to sign in with a Google account, which refuses unknown browsers. Turn off if you prefer Lumen to identify as plain Chromium. Applies to new tabs. Google may still refuse sign-in at any time."><Toggle label="Report as Google Chrome" checked={s.reportAsChrome} onChange={(v) => set({ reportAsChrome: v })} /></SettingRow>
        <SettingRow label="Use hardware acceleration when available" hint="Needs a restart. Turn off if pages show graphical glitches."><Toggle label="Hardware acceleration" checked={s.hardwareAcceleration} onChange={async (v) => { await set({ hardwareAcceleration: v }) }} /></SettingRow>
        <SettingRow label="Put unused tabs to sleep" hint="Frees the memory of background tabs that have not been used for a while. Playing and loading tabs are never put to sleep. When the computer is low on memory, tabs unused for 5 minutes are put to sleep too (unless set to Never).">
          <select className="field" value={s.backgroundTabSleepMinutes} onChange={(e) => set({ backgroundTabSleepMinutes: Number(e.target.value) })}>
            <option value={0}>Never</option><option value={10}>After 10 minutes</option><option value={30}>After 30 minutes</option><option value={60}>After 1 hour</option><option value={240}>After 4 hours</option></select></SettingRow>
        <SettingRow label="Restart Lumen" hint="Saves your tabs and starts again."><button className="btn" onClick={() => invoke('app:relaunch')}>Restart</button></SettingRow>
      </Section>
      <Section title="Cache and data">
        <SettingRow label="Cached files" hint={usage ? `${formatBytes(usage.cacheBytes)} in cache, ${usage.cookieCount} cookies` : ''}><button className="btn" onClick={async () => { await guard(invoke('data:clearCache'), 'Cache cleared'); reload() }}>Clear cache</button></SettingRow>
        <SettingRow label="Open data folder" hint={info?.userDataPath}><button className="btn" onClick={() => invoke('app:openUserData')}>Show in Explorer</button></SettingRow>
        <SettingRow label="Back up settings and bookmarks now" hint="Lumen also keeps rolling automatic backups in the data folder."><button className="btn" onClick={() => guard(invoke('app:backupNow'), 'Backup saved')}>Back up</button></SettingRow>
        <SettingRow label="Reset settings" hint="Restores all settings to their defaults. Bookmarks, history and passwords are kept."><button className="btn danger" onClick={async () => { if (confirm('Reset all settings to their defaults?')) { await invoke('settings:reset'); toast('Settings reset') } }}>Reset...</button></SettingRow>
      </Section>
      <Section title="Developer">
        <SettingRow label="Developer tools" hint="Opens in a separate window for the current tab. Shortcut: F12."><button className="btn" onClick={() => invoke('cmd', 'page.devtools')}>Open for current tab</button></SettingRow>
      </Section>
    </>
  )
}

function About() {
  const [i] = useRemote<AppInfo>('app:info', [])
  if (!i) return null
  const rows: [string, string][] = [['Lumen', i.version], ['Chromium', i.chromium], ['Electron', i.electron], ['V8', i.v8], ['Node.js', i.node], ['Platform', `${i.platform} ${i.arch}`], ['Data folder', i.userDataPath]]
  return (
    <Section title="About Lumen" description="Lumen is built on the Chromium engine through Electron, so it renders pages and runs JavaScript like Chrome and Edge.">
      {rows.map(([k, v]) => <SettingRow key={k} label={k}><span className="muted" style={{ userSelect: 'text' }}>{v}</span></SettingRow>)}
    </Section>
  )
}

function ClearDataDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [range, setRange] = useState('all')
  const [o, setO] = useState({ history: true, downloads: true, cookies: false, cache: true, passwords: false, sitePermissions: false })
  const [busy, setBusy] = useState(false)
  useEffect(() => { ref.current?.showModal() }, [])
  const since = range === 'all' ? null : Date.now() - ({ hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 28 * 86400e3 } as Record<string, number>)[range]
  const box = (k: keyof typeof o, label: string, hint?: string) => <label className="check"><input type="checkbox" checked={o[k]} onChange={(e) => setO({ ...o, [k]: e.target.checked })} /><span>{label}{hint && <span className="faint"> - {hint}</span>}</span></label>
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}>
      <div className="dlg-body">
        <h3>Clear browsing data</h3>
        <select className="field" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Time range"><option value="hour">Last hour</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="month">Last 4 weeks</option><option value="all">All time</option></select>
        {box('history', 'Browsing history')}{box('downloads', 'Download list', 'files on disk are kept')}
        {box('cookies', 'Cookies and other site data', 'always all time, signs you out of sites')}
        {box('cache', 'Cached images and files', 'always all time')}
        {box('passwords', 'Saved passwords')}{box('sitePermissions', 'Site permissions')}
      </div>
      <div className="dlg-foot"><button className="btn" onClick={() => ref.current?.close()}>Cancel</button>
        <button className="btn primary" disabled={busy || !Object.values(o).some(Boolean)} onClick={async () => { setBusy(true); await guard(invoke('data:clear', { since, ...o }), 'Browsing data cleared'); setBusy(false); ref.current?.close() }}>Clear data</button></div>
    </dialog>
  )
}

function CookieManager() {
  const [sites, reload] = useRemote<{ domain: string; count: number; names: string[] }[]>('cookies:sites', [], [], [])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const list = (sites ?? []).filter((x) => x.domain.includes(q.trim().toLowerCase()))
  const total = (sites ?? []).reduce((a, b) => a + b.count, 0)
  return (
    <Section title="Cookies" description={`${total.toLocaleString()} cookies from ${(sites ?? []).length.toLocaleString()} sites are stored in this profile.`}>
      <SettingRow label="See and delete cookies" hint="Deleting a site's cookies signs you out of it. Private windows keep their cookies in memory only."><button className="btn" onClick={() => { setOpen(!open); reload() }}>{open ? 'Hide' : 'Show sites'}</button></SettingRow>
      {open && (
        <div className="srow stack">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="field" type="search" placeholder="Search sites" aria-label="Search sites" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
            <button className="btn" disabled={total === 0} onClick={async () => { if (confirm('Delete all cookies? You will be signed out of every site.')) { await guard(invoke('cookies:removeAll'), 'All cookies deleted'); reload() } }}>Delete all cookies</button>
          </div>
          {list.length === 0 ? <span className="muted">{(sites ?? []).length ? 'No matching sites.' : 'No cookies stored.'}</span> : (
            <div className="list" style={{ maxHeight: 340, overflow: 'auto' }}>{list.slice(0, 500).map((x) => (
              <div key={x.domain}>
                <div className="item">
                  <button className="btn quiet grow" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => setOpenRow(openRow === x.domain ? null : x.domain)} aria-expanded={openRow === x.domain}>{x.domain}</button>
                  <span className="muted">{x.count}</span>
                  <button className="btn" onClick={async () => { await guard(invoke('cookies:remove', x.domain)); reload() }}>Delete</button>
                </div>
                {openRow === x.domain && <div className="sub" style={{ padding: '0 14px 10px', whiteSpace: 'normal', userSelect: 'text' }}>Cookie names: {x.names.join(', ')}{x.count > x.names.length ? ', ...' : ''}</div>}
              </div>))}
              {list.length > 500 && <div className="sub" style={{ padding: 10 }}>Showing the first 500 sites. Use search to find others.</div>}
            </div>)}
        </div>)}
    </Section>
  )
}
