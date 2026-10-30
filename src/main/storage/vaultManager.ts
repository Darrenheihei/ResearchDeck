import { app, shell } from 'electron'
import { basename, join, normalize, sep } from 'path'
import { promises as fsp, constants as fsConstants } from 'fs'
import { randomUUID } from 'crypto'
import type {
  VaultErrorCode,
  VaultListResult,
  VaultSession,
  VaultStatus,
  VaultSummary,
  VaultTree
} from '@shared/types'
import { readRegistry, writeRegistry, type RegistryVault } from './vaultRegistry'
import { loadSession, sanitizeSession, saveSession } from './sessionStore'
import { scanVaultTree } from '../fs/treeScanner'

const MARKER_DIR = '.researchdeck'
const MARKER_CONFIG = 'config.json'

/** Case-insensitive path comparison everywhere except case-sensitive Linux. */
const CASE_INSENSITIVE = process.platform !== 'linux'

export class VaultOpError extends Error {
  constructor(
    public code: VaultErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'VaultOpError'
  }
}

function samePath(a: string, b: string): boolean {
  return CASE_INSENSITIVE ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isWithin(child: string, parent: string): boolean {
  const c = CASE_INSENSITIVE ? child.toLowerCase() : child
  const p = CASE_INSENSITIVE ? parent.toLowerCase() : parent
  const padded = p.endsWith(sep) ? p : p + sep
  return c.startsWith(padded)
}

function toSummary(vault: RegistryVault, status: VaultStatus): VaultSummary {
  return {
    id: vault.id,
    name: vault.name,
    path: vault.path,
    createdAt: vault.createdAt,
    lastOpenedAt: vault.lastOpenedAt,
    status
  }
}

async function realpathOrNull(inputPath: string): Promise<string | null> {
  try {
    return await fsp.realpath(inputPath)
  } catch {
    return null
  }
}

/** Resolves the real path and verifies the target is a readable+writable directory. */
async function ensureUsableDirectory(inputPath: string): Promise<string> {
  const rp = await realpathOrNull(inputPath)
  if (!rp) throw new VaultOpError('NOT_FOUND', `Folder does not exist: ${inputPath}`)
  const st = await fsp.stat(rp).catch(() => null)
  if (!st || !st.isDirectory()) {
    throw new VaultOpError('NOT_A_DIRECTORY', `Not a folder: ${rp}`)
  }
  try {
    await fsp.access(rp, fsConstants.R_OK | fsConstants.W_OK)
  } catch {
    throw new VaultOpError('NOT_WRITABLE', `Folder is not readable and writable: ${rp}`)
  }
  return rp
}

/** Rejects a candidate path that duplicates or nests inside/outside an existing vault. */
function checkNoOverlap(candidate: string, vaults: RegistryVault[], excludeId?: string): void {
  for (const vault of vaults) {
    if (vault.id === excludeId) continue
    const other = normalize(vault.path)
    if (samePath(candidate, other)) {
      throw new VaultOpError(
        'ALREADY_A_VAULT',
        `This folder is already registered as vault “${vault.name}”.`
      )
    }
    if (isWithin(candidate, other) || isWithin(other, candidate)) {
      throw new VaultOpError(
        'OVERLAPS_EXISTING_VAULT',
        `This folder overlaps with vault “${vault.name}” (${vault.path}).`
      )
    }
  }
}

/** Creates (or resets) the .researchdeck marker that marks a folder as a vault. */
async function ensureMarker(vaultPath: string, vaultId: string): Promise<void> {
  const markerDir = join(vaultPath, MARKER_DIR)
  const st = await fsp.stat(markerDir).catch(() => null)
  if (st && !st.isDirectory()) {
    throw new VaultOpError(
      'ALREADY_A_VAULT',
      `“${MARKER_DIR}” exists as a file inside this folder.`
    )
  }
  await fsp.mkdir(markerDir, { recursive: true })
  const config = { version: 1, vaultId }
  await fsp.writeFile(join(markerDir, MARKER_CONFIG), JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * Vault names are folder names too (in the create-new flow), so they must be
 * valid cross-platform folder names. Aliases reuse the same rules.
 */
export function sanitizeVaultName(raw: unknown): string {
  if (typeof raw !== 'string') throw new VaultOpError('INVALID_INPUT', 'Missing vault name.')
  const name = raw.trim()
  if (name.length === 0) throw new VaultOpError('INVALID_NAME', 'Vault name cannot be empty.')
  if (name === '.' || name === '..')
    throw new VaultOpError('INVALID_NAME', 'That name is not allowed.')
  let hasControlChar = false
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) {
      hasControlChar = true
      break
    }
  }
  if (/[\\/:*?"<>|]/.test(name) || hasControlChar) {
    throw new VaultOpError(
      'INVALID_NAME',
      'Vault name contains characters that are not allowed in folder names.'
    )
  }
  if (name.startsWith('.'))
    throw new VaultOpError('INVALID_NAME', 'Vault name cannot start with a dot.')
  if (name.length > 100)
    throw new VaultOpError('INVALID_NAME', 'Vault name is too long (max 100 characters).')
  return name
}

export async function getDefaultVaultParent(): Promise<string> {
  return join(app.getPath('documents'), 'ResearchDeck')
}

export async function listVaults(): Promise<VaultListResult> {
  const registry = await readRegistry()
  const vaults = await Promise.all(
    registry.vaults.map(async (vault) => {
      const status: VaultStatus = (await realpathOrNull(vault.path)) ? 'ok' : 'missing'
      return toSummary(vault, status)
    })
  )
  return { vaults, lastVaultId: registry.lastVaultId }
}

export async function createVaultFromExisting(inputPath: string): Promise<VaultSummary> {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new VaultOpError('INVALID_INPUT', 'Missing folder path.')
  }
  const rp = await ensureUsableDirectory(inputPath)
  const registry = await readRegistry()
  checkNoOverlap(rp, registry.vaults)
  const id = randomUUID()
  await ensureMarker(rp, id)
  const now = new Date().toISOString()
  const vault: RegistryVault = {
    id,
    name: basename(rp),
    path: rp,
    createdAt: now,
    lastOpenedAt: now
  }
  registry.vaults.push(vault)
  registry.lastVaultId = id
  await writeRegistry(registry)
  return toSummary(vault, 'ok')
}

export async function createNewVault(name: string, parentPath: string): Promise<VaultSummary> {
  const clean = sanitizeVaultName(name)
  if (typeof parentPath !== 'string' || parentPath.trim() === '') {
    throw new VaultOpError('INVALID_INPUT', 'Missing parent folder.')
  }
  await fsp.mkdir(parentPath, { recursive: true })
  const rpParent = await ensureUsableDirectory(parentPath)
  const candidate = join(rpParent, clean)
  const registry = await readRegistry()
  checkNoOverlap(candidate, registry.vaults)
  const existing = await fsp.stat(candidate).catch(() => null)
  if (existing) {
    throw new VaultOpError(
      'ALREADY_EXISTS',
      `A folder named “${clean}” already exists in that location. Open it as an existing folder instead.`
    )
  }
  await fsp.mkdir(candidate)
  const rp = await realpathOrNull(candidate)
  if (!rp) throw new VaultOpError('UNKNOWN', 'The created folder could not be resolved.')
  const id = randomUUID()
  await ensureMarker(rp, id)
  const now = new Date().toISOString()
  const vault: RegistryVault = { id, name: clean, path: rp, createdAt: now, lastOpenedAt: now }
  registry.vaults.push(vault)
  registry.lastVaultId = id
  await writeRegistry(registry)
  return toSummary(vault, 'ok')
}

export async function openVault(id: string): Promise<{
  vault: VaultSummary
  session: VaultSession
  tree: VaultTree
}> {
  const registry = await readRegistry()
  const vault = registry.vaults.find((v) => v.id === id)
  if (!vault) throw new VaultOpError('NOT_REGISTERED', 'This vault is not registered.')
  const rp = await realpathOrNull(vault.path)
  if (!rp) {
    throw new VaultOpError('NOT_FOUND', `The vault folder is missing on disk: ${vault.path}`)
  }
  if (rp !== vault.path) vault.path = rp // Normalize symlinks.
  // Self-heal: restore the .researchdeck marker if the user deleted it.
  await ensureMarker(rp, vault.id)
  vault.lastOpenedAt = new Date().toISOString()
  registry.lastVaultId = vault.id
  await writeRegistry(registry)
  const [session, tree] = await Promise.all([loadSession(rp), scanVaultTree(rp)])
  return { vault: toSummary(vault, 'ok'), session, tree }
}

export async function renameVault(id: string, name: string): Promise<VaultSummary> {
  const clean = sanitizeVaultName(name)
  const registry = await readRegistry()
  const vault = registry.vaults.find((v) => v.id === id)
  if (!vault) throw new VaultOpError('NOT_REGISTERED', 'This vault is not registered.')
  vault.name = clean
  await writeRegistry(registry)
  const status: VaultStatus = (await realpathOrNull(vault.path)) ? 'ok' : 'missing'
  return toSummary(vault, status)
}

export async function removeVault(id: string, deleteFromDisk: boolean): Promise<null> {
  const registry = await readRegistry()
  const vault = registry.vaults.find((v) => v.id === id)
  if (!vault) throw new VaultOpError('NOT_REGISTERED', 'This vault is not registered.')
  if (deleteFromDisk) {
    try {
      await fsp.rm(vault.path, { recursive: true })
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code !== 'ENOENT') {
        throw new VaultOpError('UNKNOWN', `Failed to delete the folder: ${e.message}`)
      }
    }
  }
  registry.vaults = registry.vaults.filter((v) => v.id !== id)
  if (registry.lastVaultId === id) {
    const remaining = [...registry.vaults].sort((a, b) =>
      b.lastOpenedAt.localeCompare(a.lastOpenedAt)
    )
    registry.lastVaultId = remaining.length > 0 ? remaining[0].id : null
  }
  await writeRegistry(registry)
  return null
}

export async function relinkVault(id: string, newPath: string): Promise<VaultSummary> {
  if (typeof newPath !== 'string' || newPath.trim() === '') {
    throw new VaultOpError('INVALID_INPUT', 'Missing new folder path.')
  }
  const rp = await ensureUsableDirectory(newPath)
  const registry = await readRegistry()
  const vault = registry.vaults.find((v) => v.id === id)
  if (!vault) throw new VaultOpError('NOT_REGISTERED', 'This vault is not registered.')
  checkNoOverlap(rp, registry.vaults, id)
  await ensureMarker(rp, id)
  vault.path = rp
  await writeRegistry(registry)
  return toSummary(vault, 'ok')
}

export async function saveSessionForVault(id: string, session: VaultSession): Promise<null> {
  const registry = await readRegistry()
  const vault = registry.vaults.find((v) => v.id === id)
  if (!vault) throw new VaultOpError('NOT_REGISTERED', 'This vault is not registered.')
  const rp = await realpathOrNull(vault.path)
  if (!rp) throw new VaultOpError('NOT_FOUND', 'The vault folder is missing on disk.')
  // Self-heal: when the session save recreates .researchdeck, config.json comes
  // back with it.
  await ensureMarker(rp, vault.id)
  await saveSession(rp, sanitizeSession(session))
  return null
}

export async function revealVaultInFileManager(id: string): Promise<null> {
  const registry = await readRegistry()
  const vault = registry.vaults.find((v) => v.id === id)
  if (!vault) throw new VaultOpError('NOT_REGISTERED', 'This vault is not registered.')
  const rp = await realpathOrNull(vault.path)
  if (!rp) throw new VaultOpError('NOT_FOUND', 'The vault folder is missing on disk.')
  const errorMessage = await shell.openPath(rp)
  if (errorMessage) throw new VaultOpError('UNKNOWN', errorMessage)
  return null
}
