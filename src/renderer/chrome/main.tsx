import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../common/theme.css'
import './chrome.css'
import { invoke, useEvent, useSettings } from '../common/api.ts'
import { TabStrip } from './TabStrip.tsx'
import { Toolbar } from './Toolbar.tsx'
import { BookmarksBar } from './BookmarksBar.tsx'
import type { WindowState } from '../../shared/types.ts'

function App() {
  const [state, setState] = useState<WindowState | null>(null)
  const [settings] = useSettings()
  const [platform, setPlatform] = useState('win32')

  useEffect(() => {
    invoke<WindowState>('win:state').then(setState)
    invoke('win:info').then((i) => setPlatform(i.platform))
  }, [])
  useEvent('state', setState)

  if (!state || !settings) return <div className="chrome" />
  const active = state.tabs.find((t) => t.id === state.activeTabId) ?? null
  return (
    <div className={`chrome ${state.isPrivate ? 'private' : ''} ${platform}`}>
      <TabStrip state={state} />
      <Toolbar state={state} active={active} settings={settings} />
      {settings.showBookmarksBar && <BookmarksBar />}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
