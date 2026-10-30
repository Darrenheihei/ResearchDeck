import { join } from 'path'
import { promises as fsp } from 'fs'
import type { SessionTab, VaultSession } from '@shared/types'

const MARKER_DIR = '.researchdeck'
const SESSION_FILE = 'session.json'
const MAX_TABS = 200

export function emptySession(): VaultSession {
  return { version: 1, tabs: [], activeTabId: null }
}

/**
 * A tab path must be a safe relative path inside the vault: no absolute paths,
 * no traversal, no hidden/dot segments (which excludes the .researchdeck dir).
 */
export function isValidRelPath(relPath: unknown): relPath is string {
  if (typeof relPath !== 'string') return false
  if (relPath.length === 0 || relPath.length > 1024) return false
  if (relPath.includes('\\') || relPath.includes('\0')) return false
  if (relPath.startsWith('/')) return false
  const segments = relPath.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return false
  return true
}

/** Structural sanitization: shape, path safety, dedupe, caps, active-tab validity. */
export function sanitizeSession(raw: unknown): VaultSession {
  if (typeof raw !== 'object' || raw === null) return emptySession()
  const obj = raw as Record<string, unknown>
  const rawTabs = Array.isArray(obj.tabs) ? obj.tabs : []
  const tabs: SessionTab[] = []
  const seen = new Set<string>()
  for (const entry of rawTabs) {
    if (tabs.length >= MAX_TABS) break
    if (typeof entry !== 'object' || entry === null) continue
    const tab = entry as Record<string, unknown>
    if (!isValidRelPath(tab.relPath)) continue
    if (typeof tab.id !== 'string' || tab.id.length === 0 || tab.id.length > 64) continue
    if (seen.has(tab.relPath)) continue
    seen.add(tab.relPath)
    // Tabs saved before preview mode have no pinned field — treat them as pinned.
    const pinned = typeof tab.pinned === 'boolean' ? tab.pinned : true
    tabs.push({ id: tab.id, relPath: tab.relPath, pinned })
  }
  const activeTabId = typeof obj.activeTabId === 'string' ? obj.activeTabId : null
  const activeExists = tabs.some((t) => t.id === activeTabId)
  return { version: 1, tabs, activeTabId: activeExists ? activeTabId : null }
}

/**
 * Loads and validates a vault's session. Tabs whose files no longer exist on
 * disk are silently dropped, and the active tab falls back to null if gone.
 */
export async function loadSession(vaultPath: string): Promise<VaultSession> {
  const file = join(vaultPath, MARKER_DIR, SESSION_FILE)
  let raw: unknown
  try {
    raw = JSON.parse(await fsp.readFile(file, 'utf-8'))
  } catch {
    return emptySession()
  }
  const session = sanitizeSession(raw)
  const existing: SessionTab[] = []
  for (const tab of session.tabs) {
    try {
      const st = await fsp.stat(join(vaultPath, tab.relPath))
      if (st.isFile()) existing.push(tab)
    } catch {
      // File vanished since the last session — drop the tab silently.
    }
  }
  const activeTabId = existing.some((t) => t.id === session.activeTabId)
    ? session.activeTabId
    : null
  return { version: 1, tabs: existing, activeTabId }
}

export async function saveSession(vaultPath: string, session: VaultSession): Promise<void> {
  const dir = join(vaultPath, MARKER_DIR)
  await fsp.mkdir(dir, { recursive: true })
  const file = join(dir, SESSION_FILE)
  const tmp = `${file}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(session, null, 2), 'utf-8')
  await fsp.rename(tmp, file)
}
