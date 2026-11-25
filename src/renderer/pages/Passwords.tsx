import { useState } from 'react'
import { invoke, useRemote, timeAgo, useSettings } from '../common/api.ts'
import { Empty, PageShell, Section, SettingRow, Toggle, guard, toast } from './shared.tsx'
import type { PasswordEntry } from '../../shared/types.ts'

export function PasswordsPage() {
  const [avail] = useRemote<boolean>('passwords:available', [])
  const [list, reload] = useRemote<PasswordEntry[]>('passwords:list', [], [], [])
  const [s, update] = useSettings()
  const [shown, setShown] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')
  const rows = (list ?? []).filter((p) => `${p.origin} ${p.username}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <PageShell title="Passwords" icon="key">
      {avail === false && <div className="issue error" role="alert">Secure storage is not available on this system, so passwords cannot be saved or filled in.</div>}
      <Section description="Passwords are encrypted with your operating system's secure storage (on Windows, tied to your Windows account). Lumen never stores them in plain text.">
        {s && <SettingRow label="Offer to save passwords" hint="Not offered in private windows."><Toggle label="Offer to save passwords" checked={s.offerToSavePasswords} onChange={(v) => update({ offerToSavePasswords: v })} /></SettingRow>}
      </Section>
      <div style={{ margin: '14px 0' }}><input className="field" type="search" style={{ maxWidth: 360 }} placeholder="Search passwords" aria-label="Search passwords" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {rows.length === 0 ? <Empty icon="key" title={q ? 'No matching passwords' : 'No saved passwords'}>{q ? '' : 'When you sign in to a site, Lumen offers to save the password here.'}</Empty> : (
        <div className="card list">{rows.map((p) => (
          <div className="item" key={p.id}>
            <div className="grow"><div className="title">{p.origin.replace(/^https?:\/\//, '')}</div><div className="sub">{p.username || '(no username)'} · saved {timeAgo(p.createdAt)}</div></div>
            {shown[p.id] !== undefined && <code style={{ userSelect: 'text' }}>{shown[p.id]}</code>}
            <button className="btn" onClick={async () => { if (shown[p.id] !== undefined) { setShown(({ [p.id]: _, ...r }) => r); return } const v = await guard(invoke('passwords:reveal', p.id)); if (typeof v === 'string') setShown((o) => ({ ...o, [p.id]: v })) }}>{shown[p.id] !== undefined ? 'Hide' : 'Show'}</button>
            <button className="btn" onClick={async () => { const v = await guard(invoke('passwords:reveal', p.id)); if (typeof v === 'string') { await invoke('clipboard:write', v); toast('Password copied') } }}>Copy</button>
            <button className="btn" onClick={async () => { if (confirm(`Delete the saved password for ${p.username || p.origin}?`)) { await guard(invoke('passwords:remove', p.id)); reload() } }}>Delete</button>
          </div>))}</div>)}
    </PageShell>
  )
}
