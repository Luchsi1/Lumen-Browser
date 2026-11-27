// Preload attached to every tab. It does two unrelated things:
//  - on lumen:// pages it exposes the internal API;
//  - on websites it exposes NOTHING to the page and only watches login forms for the password manager.
import { contextBridge, ipcRenderer, webFrame } from 'electron'

if (location.protocol === 'lumen:') {
  contextBridge.exposeInMainWorld('lumen', {
    isPrivate: false,
    invoke: (channel: string, ...a: unknown[]) => ipcRenderer.invoke(channel, ...a),
    on: (channel: string, cb: (...a: any[]) => void) => {
      const fn = (_e: unknown, ...rest: unknown[]) => cb(...rest)
      ipcRenderer.on(channel, fn)
      return () => ipcRenderer.removeListener(channel, fn)
    },
  })
} else if (location.protocol === 'https:' || location.protocol === 'http:') {
  setupPasswordManager()
  if (ipcRenderer.sendSync('page:reportAsChrome') === true) addChromeObject()
}

/**
 * Electron pages have an empty window.chrome, Chrome pages have chrome.app, chrome.csi and chrome.loadTimes. Some sites (Google sign-in
 * among them) look at this to tell Chrome from an embedded app. These are the real Chrome functions, rebuilt from the Performance API
 * (that is what Chrome itself documents them as: legacy timing helpers), not placeholders.
 */
function addChromeObject() {
  const code = `(() => {
    const c = window.chrome || (window.chrome = {});
    const def = (o, k, v) => { if (!(k in o)) Object.defineProperty(o, k, { value: v, writable: true, configurable: true, enumerable: true }); };
    const nav = () => performance.getEntriesByType('navigation')[0] || {};
    const t0 = () => performance.timeOrigin / 1000;
    def(c, 'loadTimes', function loadTimes() {
      const n = nav(), o = t0();
      return {
        requestTime: o + (n.startTime || 0) / 1000, startLoadTime: o + (n.startTime || 0) / 1000,
        commitLoadTime: o + (n.responseStart || 0) / 1000, finishDocumentLoadTime: o + (n.domContentLoadedEventEnd || 0) / 1000,
        finishLoadTime: o + (n.loadEventEnd || 0) / 1000, firstPaintTime: o + ((performance.getEntriesByName('first-paint')[0] || {}).startTime || 0) / 1000,
        firstPaintAfterLoadTime: 0, navigationType: n.type === 'reload' ? 'Reload' : n.type === 'back_forward' ? 'BackForward' : 'Other',
        wasFetchedViaSpdy: n.nextHopProtocol === 'h2' || n.nextHopProtocol === 'h3', wasNpnNegotiated: n.nextHopProtocol === 'h2' || n.nextHopProtocol === 'h3',
        npnNegotiatedProtocol: n.nextHopProtocol || 'unknown', wasAlternateProtocolAvailable: false, connectionInfo: n.nextHopProtocol || 'unknown',
      };
    });
    def(c, 'csi', function csi() {
      const n = nav();
      return { startE: Math.round(t0() * 1000), onloadT: Math.round(t0() * 1000 + (n.loadEventEnd || 0)), pageT: performance.now(), tran: 15 };
    });
    def(c, 'app', {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails() { return null }, getIsInstalled() { return false }, installState(cb) { if (cb) cb('not_installed') }, runningState() { return 'cannot_run' },
    });
  })()`
  try { void webFrame.executeJavaScript(code) } catch { /* cosmetic compatibility only */ }
}

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

function findUsernameField(pw: HTMLInputElement): HTMLInputElement | null {
  const scope: ParentNode = pw.form ?? document
  const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>('input')).filter((i) => ['text', 'email', 'tel', ''].includes(i.type) && visible(i))
  let best: HTMLInputElement | null = null
  for (const i of inputs) {
    if (i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) best = i
  }
  return best
}

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter ? setter.call(el, value) : (el.value = value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function setupPasswordManager() {
  let lastSent = 0

  const capture = (root: ParentNode) => {
    const pws = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter((p) => p.value)
    if (!pws.length) return
    // With several password fields (sign up, change password) the last filled one is the new password.
    const pw = pws[pws.length - 1]
    const user = findUsernameField(pw)
    if (Date.now() - lastSent < 1000) return
    lastSent = Date.now()
    ipcRenderer.send('pw:submit', { username: user?.value ?? '', password: pw.value })
  }

  document.addEventListener('submit', (e) => {
    if (!e.isTrusted) return
    capture(e.target instanceof HTMLFormElement ? e.target : document)
  }, true)

  // Single-page apps often log in without a form submit event.
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return
    const btn = (e.target as HTMLElement | null)?.closest?.('button, input[type="submit"], [role="button"]')
    if (!btn) return
    const form = (btn as HTMLButtonElement).form
    capture(form ?? document)
  }, true)

  let filled = false
  document.addEventListener('focusin', async (e) => {
    if (!e.isTrusted || filled) return
    const t = e.target
    if (!(t instanceof HTMLInputElement) || (t.type !== 'password' && t.type !== 'email' && t.type !== 'text')) return
    const pw = t.type === 'password' ? t : (t.form ?? document).querySelector<HTMLInputElement>('input[type="password"]')
    if (!pw || !visible(pw)) return
    filled = true
    try {
      const creds: { username: string; password: string }[] = await ipcRenderer.invoke('pw:lookup')
      if (!creds.length || pw.value) { filled = false; return }
      const c = creds[0]
      const user = findUsernameField(pw)
      if (user && !user.value && c.username) setValue(user, c.username)
      setValue(pw, c.password)
    } catch { filled = false }
  }, true)
}
