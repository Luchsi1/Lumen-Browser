// Download manager built on Electron's DownloadItem (Chromium's own download stack).
import { BrowserWindow, dialog, shell, type DownloadItem, type Session, type WebContents } from 'electron'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ProfileData } from './data.ts'
import type { DownloadRecord } from '../shared/types.ts'

interface Live { item: DownloadItem; lastBytes: number; lastTime: number; speed: number }

export class DownloadManager extends EventEmitter {
  private live = new Map<string, Live>()
  private isPrivate: boolean
  constructor(private profile: ProfileData, private getDir: () => string, private getAsk: () => boolean, isPrivate: boolean, private windowFor: (wc: WebContents | null) => BrowserWindow | null) {
    super()
    this.isPrivate = isPrivate
    // Anything still marked in-progress from a previous run was interrupted by the shutdown.
    for (const d of this.profile.d.downloads) {
      if (d.status === 'progressing' || d.status === 'paused') { d.status = 'interrupted'; d.error = 'Browser closed during download'; d.canResume = false }
    }
  }

  attach(ses: Session) {
    ses.on('will-download', (event, item, wc) => { void this.onWillDownload(item, wc) })
  }

  private uniquePath(dir: string, name: string): string {
    const ext = path.extname(name), base = path.basename(name, ext)
    let p = path.join(dir, name), i = 1
    while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`)
    return p
  }

  private async onWillDownload(item: DownloadItem, wc: WebContents | null) {
    const id = randomUUID()
    const dir = this.getDir()
    fs.mkdirSync(dir, { recursive: true })
    let savePath = this.uniquePath(dir, sanitize(item.getFilename()))
    if (this.getAsk()) {
      const win = this.windowFor(wc)
      const r = await (win ? dialog.showSaveDialog(win, { defaultPath: savePath }) : dialog.showSaveDialog({ defaultPath: savePath }))
      if (r.canceled || !r.filePath) { item.cancel(); return }
      savePath = r.filePath
    }
    item.setSavePath(savePath)
    const rec: DownloadRecord = {
      id, url: item.getURL(), filename: path.basename(savePath), savePath, mime: item.getMimeType(), totalBytes: item.getTotalBytes(), receivedBytes: 0,
      status: 'progressing', canResume: item.canResume(), startedAt: Date.now(), bytesPerSecond: 0, etaSeconds: null,
    }
    this.profile.d.downloads.unshift(rec)
    if (this.profile.d.downloads.length > 1000) this.profile.d.downloads.length = 1000
    const live: Live = { item, lastBytes: 0, lastTime: Date.now(), speed: 0 }
    this.live.set(id, live)
    this.save(); this.emit('started', rec); this.emit('changed')

    item.on('updated', (_e, state) => {
      const now = Date.now()
      const received = item.getReceivedBytes()
      const dt = (now - live.lastTime) / 1000
      if (dt >= 0.5) {
        const inst = (received - live.lastBytes) / dt
        live.speed = live.speed === 0 ? inst : live.speed * 0.6 + inst * 0.4 // smoothed
        live.lastBytes = received; live.lastTime = now
      }
      rec.receivedBytes = received
      rec.totalBytes = item.getTotalBytes()
      rec.status = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
      rec.canResume = item.canResume()
      rec.bytesPerSecond = rec.status === 'progressing' ? live.speed : 0
      rec.etaSeconds = rec.totalBytes > 0 && live.speed > 1 && rec.status === 'progressing' ? Math.round((rec.totalBytes - received) / live.speed) : null
      this.emit('changed')
    })
    item.once('done', (_e, state) => {
      this.live.delete(id)
      rec.endedAt = Date.now(); rec.bytesPerSecond = 0; rec.etaSeconds = null
      rec.receivedBytes = item.getReceivedBytes()
      rec.canResume = false
      if (state === 'completed') { rec.status = 'completed'; rec.receivedBytes = rec.totalBytes = Math.max(rec.totalBytes, rec.receivedBytes) }
      else if (state === 'cancelled') rec.status = 'cancelled'
      else { rec.status = 'interrupted'; rec.error = 'The download was interrupted (network or disk error)' }
      this.save(); this.emit('done', rec); this.emit('changed')
    })
  }

  private save() { if (!this.isPrivate) this.profile.save() }

  list(): DownloadRecord[] {
    return this.profile.d.downloads.map((d) => ({ ...d, exists: d.status === 'completed' ? fs.existsSync(d.savePath) : undefined }))
  }

  activeCount() { return this.live.size }

  pause(id: string) { this.live.get(id)?.item.pause() }
  resume(id: string) {
    const l = this.live.get(id)
    if (l?.item.canResume()) l.item.resume()
  }
  cancel(id: string) { this.live.get(id)?.item.cancel() }
  open(id: string) { const d = this.find(id); if (d && fs.existsSync(d.savePath)) void shell.openPath(d.savePath) }
  showInFolder(id: string) { const d = this.find(id); if (d) shell.showItemInFolder(d.savePath) }
  remove(id: string) {
    this.cancel(id)
    this.profile.d.downloads = this.profile.d.downloads.filter((d) => d.id !== id)
    this.save(); this.emit('changed')
  }
  clearFinished() {
    this.profile.d.downloads = this.profile.d.downloads.filter((d) => d.status === 'progressing' || d.status === 'paused')
    this.save(); this.emit('changed')
  }
  private find(id: string) { return this.profile.d.downloads.find((d) => d.id === id) }
}

function sanitize(name: string): string {
  const n = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim()
  return n || 'download'
}
