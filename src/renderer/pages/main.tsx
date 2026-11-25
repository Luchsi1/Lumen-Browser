import { createRoot } from 'react-dom/client'
import '../common/theme.css'
import './pages.css'
import { useSettings } from '../common/api.ts'
import { SettingsPage } from './Settings.tsx'
import { AdblockPage } from './Adblock.tsx'
import { ExtensionsPage } from './Extensions.tsx'
import { HistoryPage } from './History.tsx'
import { BookmarksPage } from './Bookmarks.tsx'
import { DownloadsPage } from './Downloads.tsx'
import { PasswordsPage } from './Passwords.tsx'
import { NewTabPage } from './NewTab.tsx'
import { BlockedPage } from './Blocked.tsx'
import { ErrorPage } from './ErrorPage.tsx'

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
createRoot(document.getElementById('root')!).render(<App />)
