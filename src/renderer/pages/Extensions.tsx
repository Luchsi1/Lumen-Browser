import { useState } from 'react'
import { invoke, useRemote, timeAgo } from '../common/api.ts'
import { Icon } from '../common/icons.tsx'
import { Empty, PageShell, Section, Toggle, guard, toast } from './shared.tsx'
import type { ExtensionInfo, ExtensionLogEntry } from '../../shared/types.ts'

const COMPAT_TEXT: Record<string, string> = {
  full: 'No known gaps. This is based on the APIs the extension declares and uses, not on a full test.',
  partial: 'Works in part. Some features rely on APIs that Lumen only partly supports.',
  limited: 'Main features are likely not to work because required APIs are missing.',
  unsupported: 'Cannot run.',
}

export function ExtensionsPage() {
  const [list, reload] = useRemote<ExtensionInfo[]>('extensions:list', [], ['extensions:changed'], [])
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (p: Promise<any>, msg?: string) => { setBusy(true); const r = await guard(p, msg); setBusy(false); reload(); return r }
  return (
    <PageShell title="Extensions" icon="puzzle" wide actions={<>
      <button className="btn" onClick={() => invoke('extensions:webstore')}>Chrome Web Store</button>
      <button className="btn" disabled={busy} onClick={() => run(invoke('extensions:installPackage'), 'Extension installed')}>Install .crx or .zip...</button>
      <button className="btn primary" disabled={busy} onClick={() => run(invoke('extensions:installUnpacked'), 'Extension installed')}>Load unpacked...</button></>}>
      <p className="section-desc" style={{ marginTop: 8 }}>Lumen runs Chrome extensions through Electron. Many work, but not all Chrome extension APIs exist here. Each extension shows what it needs and what Lumen cannot provide. Extensions do not run in private windows.</p>
      {(list ?? []).length === 0 ? (
        <Empty icon="puzzle" title="No extensions installed">Add one from the Chrome Web Store, or choose a folder or package of your own.</Empty>
      ) : (
        <div className="card" style={{ marginTop: 14 }}>
          {(list ?? []).map((e) => <ExtensionRow key={e.id} e={e} expanded={open === e.id} toggleOpen={() => setOpen(open === e.id ? null : e.id)} run={run} />)}
        </div>
      )}
      <Section title="Permissions" description="Chrome lets you revoke an extension's site access after installing it. Lumen cannot do this: an extension keeps the permissions in its manifest. To limit it, disable or remove the extension." children={<span />} />
    </PageShell>
  )
}

function ExtensionRow({ e, expanded, toggleOpen, run }: { e: ExtensionInfo; expanded: boolean; toggleOpen: () => void; run: (p: Promise<any>, msg?: string) => Promise<any> }) {
  const [logs, reloadLogs] = useRemote<ExtensionLogEntry[]>('extensions:logs', [e.id], [], [])
  const chip = e.compat === 'full' ? 'ok' : e.compat === 'partial' ? 'warn' : 'bad'
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="item" style={{ alignItems: 'flex-start', padding: '14px 16px' }}>
        {e.iconUrl ? <img src={e.iconUrl} width={36} height={36} alt="" style={{ borderRadius: 8 }} /> : <span style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--bg-hover)', display: 'grid', placeItems: 'center' }}><Icon name="puzzle" size={18} /></span>}
        <div className="grow">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b>{e.name}</b><span className="muted">{e.version}</span><span className={`chip ${chip}`} title={COMPAT_TEXT[e.compat]}>{e.compat === 'full' ? 'No known gaps' : e.compat}</span><span className="chip">Manifest V{e.manifestVersion}</span><span className="chip">{e.source === 'webstore' ? 'Web Store' : e.source === 'package' ? 'Package' : 'Unpacked'}</span></div>
          <div className="sub" style={{ whiteSpace: 'normal' }}>{e.description}</div>
          {e.issues.filter((i) => i.level === 'error').slice(0, expanded ? 99 : 1).map((i, k) => <div key={k} className="issue error"><Icon name="warning" size={14} />{i.message}</div>)}
          <button className="btn quiet" style={{ padding: '2px 0', minHeight: 0, marginTop: 4, color: 'var(--accent)' }} onClick={toggleOpen} aria-expanded={expanded}>{expanded ? 'Hide details' : 'Details, permissions and logs'}</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <Toggle label={`Enable ${e.name}`} checked={e.enabled} onChange={(v) => run(invoke('extensions:setEnabled', e.id, v))} />
          <div style={{ display: 'flex', gap: 2 }}>
            {e.optionsUrl && <button className="icon-btn" title="Extension options" aria-label="Extension options" onClick={() => guard(invoke('extensions:options', e.id))}><Icon name="settings" size={16} /></button>}
            <button className="icon-btn" title="Reload" aria-label="Reload extension" onClick={() => run(invoke('extensions:reload', e.id), 'Extension reloaded')}><Icon name="refresh" size={16} /></button>
            <button className={`icon-btn ${e.pinned ? 'on' : ''}`} title={e.pinned ? 'Unpin from toolbar' : 'Pin to toolbar'} aria-label="Pin to toolbar" disabled={!e.hasAction} onClick={() => invoke('extensions:pin', e.id, !e.pinned)}><Icon name="pin" size={16} /></button>
            <button className="icon-btn" title="Remove" aria-label="Remove extension" onClick={() => run(invoke('extensions:uninstall', e.id))}><Icon name="trash" size={16} /></button>
          </div>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '0 16px 16px 64px', display: 'grid', gap: 14 }}>
          <div><b>Compatibility</b><div className="muted" style={{ marginBottom: 4 }}>{COMPAT_TEXT[e.compat]}</div>
            {e.issues.length === 0 ? <div className="muted">No issues found.</div> : e.issues.map((i, k) => <div key={k} className={`issue ${i.level}`}><Icon name={i.level === 'info' ? 'info' : 'warning'} size={14} /><span>{i.message}</span></div>)}</div>
          <div><b>Permissions</b>
            <div className="muted">{e.permissions.length ? e.permissions.join(', ') : 'No special permissions.'}</div>
            <div className="muted">{e.hostPermissions.length ? `Sites: ${e.hostPermissions.join(', ')}` : 'No website access.'}</div></div>
          <div className="muted" style={{ userSelect: 'text', wordBreak: 'break-all' }}>ID {e.id}<br />{e.path}</div>
          <div><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><b>Debug log</b>
            <button className="btn quiet" onClick={reloadLogs}>Refresh</button><button className="btn quiet" onClick={async () => { await invoke('extensions:clearLogs', e.id); reloadLogs(); toast('Log cleared') }}>Clear</button></div>
            <div className="logbox" tabIndex={0}>{(logs ?? []).length ? (logs ?? []).map((l, i) => <div key={i} className={l.level}>[{new Date(l.time).toLocaleTimeString()}] {l.level}{l.source ? ` (${l.source})` : ''}: {l.message}</div>) : 'No messages yet. Console output and load errors from the extension appear here.'}</div></div>
        </div>
      )}
    </div>
  )
}
void timeAgo
