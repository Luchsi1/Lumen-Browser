// Crash-safe JSON persistence: write to temp file, fsync, atomic rename, keep rolling backups.
// Reads fall back to the newest valid backup if the main file is missing or corrupt.
import fs from 'node:fs'
import path from 'node:path'

export interface StoreOptions<T> {
  dir: string
  name: string
  defaults: T
  backups?: number
  debounceMs?: number
  migrate?: (raw: any) => T
  /** Keep data in memory only. Nothing is read from or written to disk (private browsing). */
  memory?: boolean
}

export class JsonStore<T extends object> {
  data: T
  private file: string
  private dirty = false
  private timer: NodeJS.Timeout | null = null
  private writing = false
  private lastBackup = 0
  private opts: Required<Omit<StoreOptions<T>, 'migrate'>> & { migrate?: (raw: any) => T }

  constructor(opts: StoreOptions<T>) {
    this.opts = { backups: 5, debounceMs: 300, ...opts } as any
    this.file = path.join(opts.dir, `${opts.name}.json`)
    if (opts.memory) { this.data = structuredClone(opts.defaults); return }
    fs.mkdirSync(opts.dir, { recursive: true })
    this.data = this.load()
  }

  private backupDir() { return path.join(this.opts.dir, 'backups') }

  private tryRead(file: string): any | undefined {
    try {
      const txt = fs.readFileSync(file, 'utf8')
      return JSON.parse(txt)
    } catch { return undefined }
  }

  private load(): T {
    let raw = this.tryRead(this.file)
    if (raw === undefined) {
      // Main file corrupt or missing. Try backups newest first.
      const bdir = this.backupDir()
      let names: string[] = []
      try { names = fs.readdirSync(bdir).filter((n) => n.startsWith(this.opts.name + '.') && n.endsWith('.json')).sort().reverse() } catch { /* none */ }
      for (const n of names) {
        raw = this.tryRead(path.join(bdir, n))
        if (raw !== undefined) { break }
      }
      if (raw !== undefined && fs.existsSync(this.file)) {
        try { fs.renameSync(this.file, this.file + `.corrupt-${Date.now()}`) } catch { /* ignore */ }
      }
    }
    if (raw === undefined) return structuredClone(this.opts.defaults)
    if (this.opts.migrate) return this.opts.migrate(raw)
    return mergeDefaults(structuredClone(this.opts.defaults), raw) as T
  }

  /** Mark data as changed; schedules a debounced atomic write. */
  save() {
    if (this.opts.memory) return
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => { this.timer = null; this.flush() }, this.opts.debounceMs)
  }

  /** Synchronous atomic write. Safe to call from before-quit. */
  flush() {
    if (this.opts.memory) return
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.dirty || this.writing) return
    this.writing = true
    try {
      const tmp = this.file + '.tmp'
      const fd = fs.openSync(tmp, 'w')
      try {
        fs.writeFileSync(fd, JSON.stringify(this.data))
        fs.fsyncSync(fd)
      } finally { fs.closeSync(fd) }
      fs.renameSync(tmp, this.file)
      this.dirty = false
      this.rotateBackup()
    } catch (e) {
      console.error(`[store:${this.opts.name}] write failed`, e)
    } finally { this.writing = false }
  }

  private rotateBackup() {
    const now = Date.now()
    if (this.opts.backups <= 0 || now - this.lastBackup < 10 * 60 * 1000) return
    this.lastBackup = now
    try {
      const bdir = this.backupDir()
      fs.mkdirSync(bdir, { recursive: true })
      const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
      fs.copyFileSync(this.file, path.join(bdir, `${this.opts.name}.${stamp}.json`))
      const names = fs.readdirSync(bdir).filter((n) => n.startsWith(this.opts.name + '.') && n.endsWith('.json')).sort()
      while (names.length > this.opts.backups) fs.unlinkSync(path.join(bdir, names.shift()!))
    } catch (e) { console.error('[store] backup failed', e) }
  }

  /** Force a backup right now regardless of the interval. */
  backupNow() {
    this.lastBackup = 0
    this.dirty = true
    this.flush()
  }
}

/** Recursively fill missing keys from defaults; arrays and unknown keys in `raw` are kept as is. */
export function mergeDefaults(defaults: any, raw: any): any {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw === undefined ? defaults : raw
  if (defaults === null || typeof defaults !== 'object' || Array.isArray(defaults)) return raw
  const out: any = { ...defaults }
  for (const k of Object.keys(raw)) {
    out[k] = k in defaults ? mergeDefaults(defaults[k], raw[k]) : raw[k]
  }
  return out
}
