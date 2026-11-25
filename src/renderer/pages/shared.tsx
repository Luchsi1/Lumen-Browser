import type { ReactNode } from 'react'
import { Icon, type IconName } from '../common/icons.tsx'

export const isPanel = new URLSearchParams(location.search).get('panel') === '1'

export function PageShell({ title, icon, actions, children, wide }: { title: string; icon?: IconName; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`page ${isPanel ? 'panel-mode' : ''}`}>
      <header className="page-head">
        <h1>{icon && <Icon name={icon} size={isPanel ? 17 : 22} />}{title}</h1>
        <div className="page-actions">{actions}</div>
      </header>
      <main className={`page-main ${wide ? 'wide' : ''}`}>{children}</main>
    </div>
  )
}

export function Section({ title, description, children, id }: { title?: string; description?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      {title && <h2>{title}</h2>}
      {description && <p className="section-desc">{description}</p>}
      <div className="card">{children}</div>
    </section>
  )
}

export function SettingRow({ label, hint, children, stack }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`srow ${stack ? 'stack' : ''}`}>
      <div className="srow-text"><div className="srow-label">{label}</div>{hint && <div className="srow-hint">{hint}</div>}</div>
      {children && <div className="srow-ctl">{children}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <input type="checkbox" className="switch" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return <div className="empty"><Icon name={icon} size={30} /><div className="empty-title">{title}</div>{children && <div className="muted">{children}</div>}</div>
}

export function Favicon({ src, size = 16 }: { src?: string; url?: string; size?: number }) {
  return src ? <img src={src} width={size} height={size} alt="" style={{ borderRadius: 3 }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }} /> : <Icon name="globe" size={size} />
}

export function toast(msg: string, kind: 'ok' | 'error' = 'ok') {
  let host = document.getElementById('toasts')
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host) }
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.textContent = msg
  host.appendChild(el)
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500)
}

export async function guard<T>(p: Promise<T>, okMsg?: string): Promise<T | undefined> {
  try { const r = await p; if (okMsg) toast(okMsg); return r } catch (e: any) {
    toast(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error')
    return undefined
  }
}
