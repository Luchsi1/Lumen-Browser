// Persistent data: global app data (settings, profiles, session) and per-profile data
// (bookmarks, history, downloads, passwords, site permissions, extension registry).
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { JsonStore } from './store.ts'
import { DEFAULT_SETTINGS } from '../shared/defaults.ts'
import type { Bookmark, DownloadRecord, HistoryEntry, PermissionKind, PermissionValue, ProfileInfo, Settings } from '../shared/types.ts'

export interface SavedTab { url: string; title: string; pinned: boolean; groupId: string | null; favicon?: string }
export interface SavedWindow { tabs: SavedTab[]; groups: { id: string; name: string; color: string; collapsed: boolean }[]; activeIndex: number; bounds?: { x: number; y: number; width: number; height: number }; maximized?: boolean; profileId: string }
export interface SessionData { windows: SavedWindow[]; cleanExit: boolean }

export interface ExtensionRecord { id?: string; path: string; enabled: boolean; source: 'unpacked' | 'package' | 'webstore'; addedAt: number }

export interface PasswordRecord { id: string; origin: string; username: string; encrypted: string; createdAt: number }

export interface ProfileFile {
  bookmarks: Bookmark[]
  history: HistoryEntry[]
  downloads: DownloadRecord[]
  passwords: PasswordRecord[]
  sitePermissions: Record<string, Partial<Record<PermissionKind, PermissionValue>>>
  zoom: Record<string, number>
  extensions: ExtensionRecord[]
  closedTabs: SavedTab[]
  adblockAllow: string[] // reserved
}

const PROFILE_DEFAULTS: ProfileFile = {
  bookmarks: [], history: [], downloads: [], passwords: [], sitePermissions: {}, zoom: {}, extensions: [], closedTabs: [], adblockAllow: [],
}

export class AppData {
  settings: JsonStore<Settings>
  profiles: JsonStore<{ profiles: ProfileInfo[]; lastUsed: string }>
  session: JsonStore<SessionData>
  dir: string
  private profileStores = new Map<string, ProfileData>()

  constructor(dir: string) {
    this.dir = dir
    this.settings = new JsonStore<Settings>({ dir, name: 'settings', defaults: DEFAULT_SETTINGS })
    this.profiles = new JsonStore({ dir, name: 'profiles', defaults: { profiles: [{ id: 'default', name: 'Personal', color: '#4f7cff' }], lastUsed: 'default' } })
    this.session = new JsonStore<SessionData>({ dir, name: 'session', defaults: { windows: [], cleanExit: true }, debounceMs: 1000 })
    // Make sure stored builtin lists always include newly added builtin lists in later versions.
    const have = new Set(this.settings.data.adblock.lists.map((l) => l.id))
    let changed = false
    for (const l of DEFAULT_SETTINGS.adblock.lists) if (!have.has(l.id)) { this.settings.data.adblock.lists.push({ ...l }); changed = true }
    if (changed) this.settings.save()
  }

  profile(id: string): ProfileData {
    let p = this.profileStores.get(id)
    if (!p) {
      p = new ProfileData(path.join(this.dir, 'profiles', id))
      this.profileStores.set(id, p)
    }
    return p
  }

  addProfile(name: string, color: string): ProfileInfo {
    const info = { id: randomUUID().slice(0, 8), name: name.trim() || 'Profile', color }
    this.profiles.data.profiles.push(info)
    this.profiles.save()
    return info
  }

  removeProfile(id: string) {
    if (id === 'default') return
    this.profiles.data.profiles = this.profiles.data.profiles.filter((p) => p.id !== id)
    this.profiles.save()
    this.profileStores.delete(id)
  }

  flushAll() {
    this.settings.flush(); this.profiles.flush(); this.session.flush()
    for (const p of this.profileStores.values()) p.flush()
  }
}

export class ProfileData {
  store: JsonStore<ProfileFile>
  dir: string
  constructor(dir: string, memory = false) {
    this.dir = dir
    this.store = new JsonStore<ProfileFile>({ dir, name: 'profile', defaults: PROFILE_DEFAULTS, memory })
  }
  get d() { return this.store.data }
  save() { this.store.save() }
  flush() { this.store.flush() }

  // ---- bookmarks ----
  private nextIndex(parentId: string | null) {
    return this.d.bookmarks.filter((b) => b.parentId === parentId).reduce((m, b) => Math.max(m, b.index + 1), 0)
  }
  ensureRoots() {
    if (!this.d.bookmarks.some((b) => b.id === 'bar')) {
      this.d.bookmarks.push({ id: 'bar', type: 'folder', parentId: null, title: 'Bookmarks bar', createdAt: Date.now(), index: 0 })
      this.d.bookmarks.push({ id: 'other', type: 'folder', parentId: null, title: 'Other bookmarks', createdAt: Date.now(), index: 1 })
      this.save()
    }
  }
  addBookmark(b: { title: string; url?: string; parentId?: string | null; type?: 'bookmark' | 'folder'; favicon?: string }): Bookmark {
    this.ensureRoots()
    const parentId = b.parentId ?? 'bar'
    const bm: Bookmark = { id: randomUUID(), type: b.type ?? 'bookmark', parentId, title: b.title, url: b.url, favicon: b.favicon, createdAt: Date.now(), index: this.nextIndex(parentId) }
    this.d.bookmarks.push(bm); this.save()
    return bm
  }
  findBookmarkByUrl(url: string) { return this.d.bookmarks.find((b) => b.type === 'bookmark' && b.url === url) }
  updateBookmark(id: string, patch: Partial<Pick<Bookmark, 'title' | 'url' | 'parentId'>>) {
    const b = this.d.bookmarks.find((x) => x.id === id)
    if (!b || id === 'bar' || id === 'other') return
    if (patch.parentId !== undefined && patch.parentId !== b.parentId) {
      if (this.isDescendant(patch.parentId, id)) return // refuse cycles
      b.parentId = patch.parentId; b.index = this.nextIndex(patch.parentId)
    }
    if (patch.title !== undefined) b.title = patch.title
    if (patch.url !== undefined && b.type === 'bookmark') b.url = patch.url
    this.save()
  }
  isDescendant(candidate: string | null, ancestorId: string): boolean {
    let cur = candidate
    const seen = new Set<string>()
    while (cur) {
      if (cur === ancestorId) return true
      if (seen.has(cur)) return false
      seen.add(cur)
      cur = this.d.bookmarks.find((b) => b.id === cur)?.parentId ?? null
    }
    return false
  }
  removeBookmark(id: string) {
    if (id === 'bar' || id === 'other') return
    const doomed = new Set<string>([id])
    let grew = true
    while (grew) {
      grew = false
      for (const b of this.d.bookmarks) if (b.parentId && doomed.has(b.parentId) && !doomed.has(b.id)) { doomed.add(b.id); grew = true }
    }
    this.d.bookmarks = this.d.bookmarks.filter((b) => !doomed.has(b.id)); this.save()
  }
  /** Move `id` into `parentId` at position `index` among its siblings (drag and drop). */
  moveBookmark(id: string, parentId: string | null, index: number) {
    const b = this.d.bookmarks.find((x) => x.id === id)
    if (!b || id === 'bar' || id === 'other' || this.isDescendant(parentId, id)) return
    const oldParent = b.parentId
    b.parentId = parentId
    const sibs = this.d.bookmarks.filter((x) => x.parentId === parentId && x.id !== id).sort((a, c) => a.index - c.index)
    sibs.splice(Math.max(0, Math.min(index, sibs.length)), 0, b)
    sibs.forEach((s, i) => { s.index = i })
    if (oldParent !== parentId) this.d.bookmarks.filter((x) => x.parentId === oldParent).sort((a, c) => a.index - c.index).forEach((s, i) => { s.index = i })
    this.save()
  }

  // ---- history ----
  addVisit(url: string, title: string, favicon?: string) {
    const h = this.d.history
    const now = Date.now()
    const recent = h.find((e) => e.url === url)
    if (recent) {
      recent.visitedAt = now; recent.visitCount++; if (title) recent.title = title; if (favicon) recent.favicon = favicon
    } else {
      h.push({ id: randomUUID(), url, title: title || url, visitedAt: now, visitCount: 1, favicon })
      if (h.length > 50000) h.splice(0, h.length - 50000)
    }
    this.save()
  }
  updateVisitTitle(url: string, title: string, favicon?: string) {
    const e = this.d.history.find((x) => x.url === url)
    if (e) { if (title) e.title = title; if (favicon) e.favicon = favicon; this.save() }
  }

  // ---- permissions ----
  getSitePermission(origin: string, kind: PermissionKind): PermissionValue | undefined { return this.d.sitePermissions[origin]?.[kind] }
  setSitePermission(origin: string, kind: PermissionKind, value: PermissionValue | null) {
    const o = (this.d.sitePermissions[origin] ??= {})
    if (value === null || value === 'ask') delete o[kind]; else o[kind] = value
    if (Object.keys(o).length === 0) delete this.d.sitePermissions[origin]
    this.save()
  }
}

export function ensureDir(p: string) { fs.mkdirSync(p, { recursive: true }); return p }
