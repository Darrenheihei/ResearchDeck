import { app } from 'electron'
import { join } from 'path'
import { promises as fsp } from 'fs'

export interface RegistryVault {
  id: string
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string
}

export interface VaultRegistryFile {
  version: 1
  lastVaultId: string | null
  vaults: RegistryVault[]
}

function isRegistryVault(value: unknown): value is RegistryVault {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.path === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.lastOpenedAt === 'string'
  )
}

function registryPath(): string {
  return join(app.getPath('userData'), 'vaults.json')
}

export function emptyRegistry(): VaultRegistryFile {
  return { version: 1, lastVaultId: null, vaults: [] }
}

export async function readRegistry(): Promise<VaultRegistryFile> {
  try {
    const parsed = JSON.parse(await fsp.readFile(registryPath(), 'utf-8')) as Record<
      string,
      unknown
    >
    if (parsed.version !== 1 || !Array.isArray(parsed.vaults)) {
      console.warn('[vault-registry] Unrecognized vaults.json — starting with an empty registry')
      return emptyRegistry()
    }
    const vaults = (parsed.vaults as unknown[]).filter(isRegistryVault)
    const lastVaultId = typeof parsed.lastVaultId === 'string' ? parsed.lastVaultId : null
    return { version: 1, lastVaultId, vaults }
  } catch {
    // Missing or unreadable file — first launch or corrupted file; start fresh.
    return emptyRegistry()
  }
}

export async function writeRegistry(registry: VaultRegistryFile): Promise<void> {
  const target = registryPath()
  const tmp = `${target}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(registry, null, 2), 'utf-8')
  await fsp.rename(tmp, target)
}
