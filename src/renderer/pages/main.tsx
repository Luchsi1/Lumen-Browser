import { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import '../common/theme.css'
import './pages.css'
import { useSettings } from '../common/api.ts'

// Every lumen:// tab runs this entry, but only needs its own page: the others are separate chunks that are never loaded
// (less script to parse and keep in memory for each internal tab and for the side panel).
const SettingsPage = lazy(() => import('./Settings.tsx').then((m) => ({ default: m.SettingsPage })))
const AdblockPage = lazy(() => import('./Adblock.tsx').then((m) => ({ default: m.AdblockPage })))
const ExtensionsPage = lazy(() => import('./Extensions.tsx').then((m) => ({ default: m.ExtensionsPage })))
const HistoryPage = lazy(() => import('./History.tsx').then((m) => ({ default: m.HistoryPage })))
const BookmarksPage = lazy(() => import('./Bookmarks.tsx').then((m) => ({ default: m.BookmarksPage })))
const DownloadsPage = lazy(() => import('./Downloads.tsx').then((m) => ({ default: m.DownloadsPage })))
const PasswordsPage = lazy(() => import('./Passwords.tsx').then((m) => ({ default: m.PasswordsPage })))
const NewTabPage = lazy(() => import('./NewTab.tsx').then((m) => ({ default: m.NewTabPage })))
const BlockedPage = lazy(() => import('./Blocked.tsx').then((m) => ({ default: m.BlockedPage })))
const ErrorPage = lazy(() => import('./ErrorPage.tsx').then((m) => ({ default: m.ErrorPage })))

const TITLES: Record<string, string> = { settings: 'Settings', adblock: 'Ad blocker', extensions: 'Extensions', history: 'History', bookmarks: 'Bookmarks', downloads: 'Downloads', passwords: 'Passwords', newtab: 'New tab', blocked: 'Page blocked', error: 'Page not available' }

function App() {
  useSettings() // applies theme and accent
  const host = location.host
  document.title = TITLES[host] ?? 'Lumen'
  switch (host) {
    case 'settings': return <SettingsPage />
    case 'adblock': return <AdblockPage />
    case 'extensions': return <ExtensionsPage />
    case 'history': return <HistoryPage />
    case 'bookmarks': return <BookmarksPage />
    case 'downloads': return <DownloadsPage />
    case 'passwords': return <PasswordsPage />
    case 'newtab': return <NewTabPage />
    case 'blocked': return <BlockedPage />
    case 'error': return <ErrorPage />
    default: return <div className="center-page"><div className="center-card"><h1>Page not found</h1><p className="muted">lumen://{host} does not exist.</p></div></div>
  }
}
createRoot(document.getElementById('root')!).render(<Suspense fallback={null}><App /></Suspense>)
