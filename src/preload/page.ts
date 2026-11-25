// Preload attached to every tab. It does two unrelated things:
//  - on lumen:// pages it exposes the internal API;
//  - on websites it exposes NOTHING to the page and only watches login forms for the password manager.
import { contextBridge, ipcRenderer } from 'electron'

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
