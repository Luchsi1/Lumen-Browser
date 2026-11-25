// Application entry point.
import { app, BrowserWindow, Menu, nativeTheme, protocol, session, shell } from 'electron'
import path from 'node:path'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { AppData } from './data.ts'
import { AdblockService } from './adblock.ts'
import { Browser } from './browser.ts'
import { registerIpc } from './ipc.ts'
import { chromeUserAgent } from './profile.ts'

const dist = path.join(__dirname, '..')
const isDev = process.env.LUMEN_DEV === '1'

protocol.registerSchemesAsPrivileged([
  { scheme: 'lumen', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, allowServiceWorkers: false } },
])

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }

// Data is read before ready so Chromium switches can still be applied.
const data = new AppData(app.getPath('userData'))
if (!data.settings.data.hardwareAcceleration) app.disableHardwareAcceleration()
app.userAgentFallback = chromeUserAgent()
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,PlatformHEVCDecoderSupport')
app.commandLine.appendSwitch('disable-features', 'Translate,MediaRouter')
if (isDev) app.commandLine.appendSwitch('remote-debugging-port', '9222')

let browser: Browser | null = null

function urlsFromArgv(argv: string[]): string[] {
  return argv.slice(app.isPackaged ? 1 : 2).filter((a) => /^(https?:\/\/|file:\/\/)/i.test(a))
}

app.on('second-instance', (_e, argv) => {
  if (!browser) return
  const urls = urlsFromArgv(argv)
  const w = browser.focusedWin()
  if (w) {
    if (w.win.isMinimized()) w.win.restore()
    w.win.focus()
    for (const u of urls) browser.addTab(w, u)
  } else void browser.createWindow({ urls })
})

app.on('certificate-error', (event, wc, url, _error, _cert, callback) => {
  try {
    if (browser?.isCertificateAllowed(new URL(url).hostname)) { event.preventDefault(); callback(true); return }
  } catch { /* fall through */ }
  callback(false)
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

app.on('before-quit', () => {
  if (browser) { browser.quitting = true; browser.saveSessionNow(); browser.markCleanExit() }
  adblockService?.flush()
  data.flushAll()
})

app.on('activate', () => { if (browser && BrowserWindow.getAllWindows().length === 0) void browser.createWindow({}) })

app.on('web-contents-created', (_e, wc) => {
  // Never let any content attach <webview> or open arbitrary new windows outside our handlers.
  wc.on('will-attach-webview', (e) => e.preventDefault())
})

let adblockService: AdblockService | null = null

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  nativeTheme.themeSource = data.settings.data.theme

  const uiSession = session.fromPartition('persist:lumen-ui')
  ElectronChromeExtensions.handleCRXProtocol(uiSession)

  adblockService = new AdblockService(data)
  adblockService.init()

  browser = new Browser(data, adblockService, {
    dist,
    chromePreload: path.join(dist, 'preload', 'chrome.js'),
    pagePreload: path.join(dist, 'preload', 'page.js'),
    chromeHtml: path.join(dist, 'renderer', 'chrome.html'),
    overlayHtml: path.join(dist, 'renderer', 'overlay.html'),
    icon: path.join(dist, '..', 'build', 'icon.png'),
  }, uiSession)
  registerIpc(browser, data, adblockService, path.join(dist, 'renderer'))
  adblockService.on('changed', () => browser?.broadcast('adblock:changed'))

  const s = data.session.data
  const crashed = !s.cleanExit
  const cliUrls = urlsFromArgv(process.argv)
  const restore = (crashed || data.settings.data.startup === 'restore') && s.windows.length > 0
  if (restore) {
    for (const sw of s.windows) await browser.createWindow({ profileId: sw.profileId, restore: sw, bounds: sw.bounds })
    for (const u of cliUrls) browser.addTab(browser.focusedWin()!, u)
  } else {
    const urls = cliUrls.length ? cliUrls : data.settings.data.startup === 'home' ? [data.settings.data.homepage || 'lumen://newtab'] : undefined
    await browser.createWindow({ urls })
  }
  // From now on an unclean shutdown can be detected on the next start.
  data.session.data.cleanExit = false
  data.session.flush()

  if (isDev) console.log('[lumen] dev mode: remote debugging on http://localhost:9222')
})

process.on('uncaughtException', (e) => console.error('[uncaughtException]', e))
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e))
void shell
