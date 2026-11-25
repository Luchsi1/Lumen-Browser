import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../common/theme.css'
import './overlay.css'
import { invoke, useEvent, useSettings } from '../common/api.ts'
import { AdblockPanel, BookmarkEdit, DownloadsPanel, ExtensionsPanel, FindBar, GroupEdit, MainMenu, ProfilesPanel, PromptPanel, SiteInfoPanel, Suggestions } from './panels.tsx'
import type { OverlayRequest } from '../../shared/types.ts'

const COMPACT = new Set(['suggestions', 'find', 'zoom'])

function Overlay() {
  const [req, setReq] = useState<OverlayRequest | null>(null)
  useSettings()
  useEvent('overlay:show', (r: OverlayRequest) => setReq(r))
  useEvent('overlay:hide', () => setReq(null))
  useEffect(() => { invoke('overlay:current').then((r) => r && setReq(r)).catch(() => {}) }, [])

  const close = () => { setReq(null); invoke('overlay:hide') }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && req && req.kind !== 'prompt') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!req) return null
  const compact = COMPACT.has(req.kind)
  const content = renderPanel(req, close)
  if (compact) return <div className="compact">{content}</div>
  return (
    <div className={`backdrop ${req.kind === 'prompt' ? 'dim' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget && req.kind !== 'prompt') close() }} onContextMenu={(e) => e.preventDefault()}>
      <Positioned req={req}>{content}</Positioned>
    </div>
  )
}

function Positioned({ req, children }: { req: OverlayRequest; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const vw = window.innerWidth, vh = window.innerHeight
    const w = Math.min(req.width, vw - 16)
    if (req.kind === 'prompt') { setPos({ left: Math.round((vw - w) / 2), top: 70, maxH: vh - 90 }); return }
    const a = req.anchor
    let left = req.align === 'left' ? a.x : a.x + a.width - w
    left = Math.max(8, Math.min(left, vw - w - 8))
    const top = a.y + a.height + 6
    setPos({ left, top, maxH: vh - top - 12 })
  }, [req])
  return (
    <div ref={ref} className="panel" role="dialog" style={{ width: Math.min(req.width, window.innerWidth - 16), left: pos?.left ?? 0, top: pos?.top ?? 0, maxHeight: pos?.maxH, visibility: pos ? 'visible' : 'hidden' }}>
      {children}
    </div>
  )
}

function renderPanel(req: OverlayRequest, close: () => void) {
  const p = (req.props ?? {}) as any
  switch (req.kind) {
    case 'adblock': return <AdblockPanel tabId={p.tabId} close={close} />
    case 'site-info': return <SiteInfoPanel tabId={p.tabId} close={close} />
    case 'extensions': return <ExtensionsPanel close={close} />
    case 'downloads': return <DownloadsPanel close={close} />
    case 'profiles': return <ProfilesPanel close={close} />
    case 'menu': return <MainMenu mode={p.mode} folderId={p.folderId} close={close} />
    case 'bookmark-edit': return <BookmarkEdit id={p.id} close={close} />
    case 'group-edit': return <GroupEdit group={p.group} close={close} />
    case 'prompt': return <PromptPanel request={p.request} />
    case 'suggestions': return <Suggestions rows={p.rows} selected={p.selected} />
    case 'find': return <FindBar close={close} />
    default: return null
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><Overlay /></StrictMode>)
