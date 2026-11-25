// Password vault. Secrets are encrypted with Electron safeStorage (Windows DPAPI, macOS Keychain, Linux libsecret).
// If the OS cannot provide encryption, nothing is stored: passwords are never written in plain text.
import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type { ProfileData, PasswordRecord } from './data.ts'
import type { PasswordEntry } from '../shared/types.ts'

export class PasswordVault {
  constructor(private profile: ProfileData) {}

  static available(): boolean {
    try { return safeStorage.isEncryptionAvailable() } catch { return false }
  }

  private get rows(): PasswordRecord[] { return this.profile.d.passwords }

  find(origin: string, username: string) { return this.rows.find((r) => r.origin === origin && r.username === username) }

  /** Returns 'saved' | 'updated' | 'unchanged'. Throws when OS encryption is unavailable. */
  save(origin: string, username: string, password: string): 'saved' | 'updated' | 'unchanged' {
    if (!PasswordVault.available()) throw new Error('Secure storage is not available on this system, so passwords cannot be saved.')
    const existing = this.find(origin, username)
    const encrypted = safeStorage.encryptString(password).toString('base64')
    if (existing) {
      if (this.decrypt(existing) === password) return 'unchanged'
      existing.encrypted = encrypted; existing.createdAt = Date.now(); this.profile.save()
      return 'updated'
    }
    this.rows.push({ id: randomUUID(), origin, username, encrypted, createdAt: Date.now() })
    this.profile.save()
    return 'saved'
  }

  private decrypt(r: PasswordRecord): string | null {
    try { return safeStorage.decryptString(Buffer.from(r.encrypted, 'base64')) } catch { return null }
  }

  list(): PasswordEntry[] {
    return this.rows.map(({ id, origin, username, createdAt }) => ({ id, origin, username, createdAt })).sort((a, b) => a.origin.localeCompare(b.origin))
  }

  remove(id: string) { this.profile.d.passwords = this.rows.filter((r) => r.id !== id); this.profile.save() }

  reveal(id: string): string | null {
    const r = this.rows.find((x) => x.id === id)
    return r ? this.decrypt(r) : null
  }

  lookup(origin: string): { username: string; password: string }[] {
    const out: { username: string; password: string }[] = []
    for (const r of this.rows.filter((x) => x.origin === origin).sort((a, b) => b.createdAt - a.createdAt)) {
      const p = this.decrypt(r)
      if (p !== null) out.push({ username: r.username, password: p })
    }
    return out
  }
}
