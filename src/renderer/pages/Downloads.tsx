import { invoke, useRemote, formatBytes, formatEta, timeAgo, useSettings } from '../common/api.ts'
import { Icon } from '../common/icons.tsx'
import { Empty, PageShell, guard } from './shared.tsx'
import type { DownloadRecord } from '../../shared/types.ts'

export function DownloadsPage() {
  const [list, reload] = useRemote<DownloadRecord[]>('downloads:list', [], ['downloads:changed'], [])
  const [s] = useSettings()
  const rows = [...(list ?? [])].sort((a, b) => b.startedAt - a.startedAt)
  const act = (ch: string, id: string) => guard(invoke(ch, id)).then(reload)
  return (
    <PageShell title="Downloads" icon="download" actions={<button className="btn" onClick={() => act('downloads:clear', '')}>Clear finished</button>}>
      {s && <p className="section-desc">Saving to <b>{s.downloadDir || 'your Downloads folder'}</b>{s.askDownloadLocation ? ' (asking each time)' : ''}. Change this in Settings.</p>}
      {rows.length === 0 ? <Empty icon="download" title="No downloads">Files you download appear here.</Empty> : (
        <div className="card list">{rows.map((d) => {
          const live = d.status === 'progressing' || d.status === 'paused'
          const pct = d.totalBytes > 0 ? Math.min(100, (d.receivedBytes / d.totalBytes) * 100) : 0
          return (
            <div className="item" key={d.id} style={{ alignItems: 'flex-start', padding: '12px 14px' }}>
              <Icon name="download" size={20} />
              <div className="grow">
                <div className="title" style={{ fontWeight: 600 }}>{d.filename}</div>
                <div className="sub">{d.url}</div>
                {live && <><progress value={pct} max={100} style={{ width: '100%', margin: '6px 0 2px' }} aria-label={`${d.filename} progress`} />
                  <div className="sub">{formatBytes(d.receivedBytes)}{d.totalBytes > 0 ? ` of ${formatBytes(d.totalBytes)}` : ''}{d.status === 'paused' ? ' · Paused' : ` · ${formatBytes(d.bytesPerSecond)}/s${d.etaSeconds != null ? ` · ${formatEta(d.etaSeconds)} left` : ''}`}</div></>}
                {d.status === 'completed' && <div className="sub">{d.exists === false ? 'File was moved or deleted' : `${formatBytes(d.totalBytes || d.receivedBytes)} · ${timeAgo(d.endedAt ?? d.startedAt)}`}</div>}
                {d.status === 'cancelled' && <div className="sub">Cancelled</div>}
                {d.status === 'interrupted' && <div className="sub" style={{ color: 'var(--danger)' }}>Failed{d.error ? `: ${d.error}` : ''}</div>}
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                {d.status === 'progressing' && <button className="btn" onClick={() => act('downloads:pause', d.id)}>Pause</button>}
                {d.status === 'paused' && <button className="btn" onClick={() => act('downloads:resume', d.id)}>Resume</button>}
                {live && <button className="btn" onClick={() => act('downloads:cancel', d.id)}>Cancel</button>}
                {d.status === 'interrupted' && (d.canResume ? <button className="btn" onClick={() => act('downloads:resume', d.id)}>Resume</button> : <button className="btn" onClick={() => act('downloads:retry', d.id)}>Retry</button>)}
                {d.status === 'cancelled' && <button className="btn" onClick={() => act('downloads:retry', d.id)}>Retry</button>}
                {d.status === 'completed' && d.exists !== false && <button className="btn" onClick={() => act('downloads:open', d.id)}>Open</button>}
                {d.status === 'completed' && d.exists !== false && <button className="btn" onClick={() => act('downloads:show', d.id)}>Show in folder</button>}
                {!live && <button className="icon-btn" aria-label="Remove from list" title="Remove from list" onClick={() => act('downloads:remove', d.id)}><Icon name="close" size={15} /></button>}
              </div>
            </div>)
        })}</div>)}
    </PageShell>
  )
}
