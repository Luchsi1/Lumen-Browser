import { invoke } from '../common/api.ts'
import { Icon } from '../common/icons.tsx'

const CERT = /^(-2(0[1-9]|[1-9]\d)|-1[0-9]{2}|-2[0-9]{2}|-3[0-9]{2})$/
const HINTS: Record<string, string> = {
  ERR_NAME_NOT_RESOLVED: 'The address could not be found. Check for typos, and check your internet connection or DNS settings.',
  ERR_INTERNET_DISCONNECTED: 'You are offline. Connect to a network and try again.',
  ERR_CONNECTION_REFUSED: 'The site refused the connection. It may be down, or the port may be wrong.',
  ERR_CONNECTION_TIMED_OUT: 'The site took too long to respond.',
  ERR_CONNECTION_RESET: 'The connection was interrupted. A firewall or proxy may be blocking it.',
  ERR_TUNNEL_CONNECTION_FAILED: 'The proxy server could not connect. Check your proxy settings.',
  ERR_BLOCKED_BY_CLIENT: 'A filter rule blocked this request.',
}

export function ErrorPage() {
  const p = new URLSearchParams(location.search)
  const code = Number(p.get('code') ?? 0)
  const desc = p.get('desc') ?? 'ERR_FAILED'
  const url = p.get('url') ?? ''
  const isCert = desc.startsWith('ERR_CERT_') || desc.startsWith('ERR_SSL_') || desc === 'ERR_BAD_SSL_CLIENT_AUTH_CERT'
  void CERT
  let host = url
  try { host = new URL(url).hostname } catch { /* raw */ }
  return (
    <div className="center-page"><div className="center-card">
      <Icon name="warning" size={40} />
      <h1>{isCert ? 'This connection is not private' : `Can't reach ${host || 'this page'}`}</h1>
      <p>{isCert ? `Lumen could not verify the security certificate of ${host}. Someone may be intercepting your connection, or the site's certificate is misconfigured or expired.` : HINTS[desc] ?? 'The page could not be loaded.'}</p>
      <div className="code">{desc} ({code}){url ? ` · ${url}` : ''}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => invoke('errorpage:retry')}>Try again</button>
        {isCert && url && <button className="btn" onClick={() => { if (confirm(`Continue to ${host} without a verified certificate? Your data on this site could be read or changed by others.`)) invoke('cert:proceed', url) }}>Continue to site (unsafe)</button>}
      </div>
    </div></div>
  )
}
