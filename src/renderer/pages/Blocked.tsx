import { invoke } from '../common/api.ts'
import { Icon } from '../common/icons.tsx'

export function BlockedPage() {
  const p = new URLSearchParams(location.search)
  const url = p.get('url') ?? ''
  const rule = p.get('rule') ?? ''
  let host = url
  try { host = new URL(url).hostname } catch { /* keep raw */ }
  return (
    <div className="center-page"><div className="center-card">
      <Icon name="shield" size={40} />
      <h1>Page blocked</h1>
      <p>Lumen blocked <b>{host}</b> because it appears on a list of sites that distribute malware, phishing or tracking.</p>
      {rule && <div className="code">Matched rule: {rule}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => history.length > 1 ? history.back() : invoke('nav:go', 'lumen://newtab')}>Go back</button>
        <button className="btn" onClick={async () => { await invoke('adblock:allowAdd', host); invoke('nav:go', url) }}>Allow this site and continue</button>
      </div>
      <p className="muted">Only continue if you trust this site. Allowing it turns the ad blocker off for {host} until you remove it in the allowlist.</p>
    </div></div>
  )
}
