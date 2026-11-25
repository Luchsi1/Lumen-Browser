// Preload for the browser's own UI (tab strip, toolbar, overlay). Never attached to websites.
import { contextBridge, ipcRenderer } from 'electron'
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'

const args = process.argv
const isPrivate = args.includes('--lumen-window-private=1')

contextBridge.exposeInMainWorld('lumen', {
  isPrivate,
  invoke: (channel: string, ...a: unknown[]) => ipcRenderer.invoke(channel, ...a),
  on: (channel: string, cb: (...a: any[]) => void) => {
    const fn = (_e: unknown, ...rest: unknown[]) => cb(...rest)
    ipcRenderer.on(channel, fn)
    return () => ipcRenderer.removeListener(channel, fn)
  },
})

// Provides the browserAction global used to render extension buttons and open their popups.
try { injectBrowserAction() } catch (e) { console.error('browser action injection failed', e) }
