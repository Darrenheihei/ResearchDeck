import { promises as fsp } from 'node:fs'
import { resolve, sep } from 'node:path'
import { dialog, ipcMain } from 'electron'
import type { AppSettings, Result, VaultErrorCode } from '@shared/types'
import { isTheme, readSettings, writeSettings } from './storage/appSettings'
import { isValidRelPath } from './storage/sessionStore'
import {
  VaultOpError,
  createNewVault,
  createVaultFromExisting,
  getDefaultVaultParent,
  listVaults,
  openVault,
  relinkVault,
  revealVaultInFileManager,
  removeVault,
  renameVault,
  saveSessionForVault
} from './storage/vaultManager'
import { scanVaultTree } from './fs/treeScanner'
import { readRegistry } from './storage/vaultRegistry'

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

function fail(code: VaultErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } }
}

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn())
  } catch (err) {
    if (err instanceof VaultOpError) return fail(err.code, err.message)
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ipc] Unhandled error:', err)
    return fail('UNKNOWN', message)
  }
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) {
    throw new VaultOpError('INVALID_INPUT', 'Malformed request payload.')
  }
  return payload as Record<string, unknown>
}

function asString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new VaultOpError('INVALID_INPUT', `Missing or invalid "${key}" in request.`)
  }
  return value
}

export function registerIpcHandlers(): void {
  ipcMain.handle('app:getSettings', () => wrap(readSettings))

  // Raw bytes of a file inside a registered vault (PDF viewer etc.). Typed
  // arrays cross IPC via structured clone — no fetch/CORS/protocol involved.
  ipcMain.handle('vault:readFile', (_event, payload) =>
    wrap(async () => {
      const record = asRecord(payload)
      const id = asString(record, 'id')
      const relPath = asString(record, 'relPath')
      if (!isValidRelPath(relPath))
        throw new VaultOpError('INVALID_INPUT', 'Invalid vault file path.')
      const registry = await readRegistry()
      const vault = registry.vaults.find((v) => v.id === id)
      if (!vault) throw new VaultOpError('NOT_REGISTERED', 'Vault not found.')
      const root = resolve(vault.path)
      const absPath = resolve(root, relPath)
      if (!absPath.startsWith(root + sep))
        throw new VaultOpError('INVALID_INPUT', 'Path escapes the vault root.')
      return new Uint8Array(await fsp.readFile(absPath))
    })
  )

  ipcMain.handle('app:setTheme', (_event, payload) =>
    wrap(async () => {
      const theme = asRecord(payload).theme
      if (!isTheme(theme))
        throw new VaultOpError('INVALID_INPUT', 'theme must be "light" or "dark".')
      const settings: AppSettings = { version: 1, theme }
      await writeSettings(settings)
      return settings
    })
  )

  ipcMain.handle('app:getDefaultVaultParent', () => wrap(getDefaultVaultParent))

  ipcMain.handle('dialog:pickDirectory', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a vault folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('vault:list', () => wrap(listVaults))

  ipcMain.handle('vault:createExisting', (_event, payload) =>
    wrap(async () => createVaultFromExisting(asString(asRecord(payload), 'path')))
  )

  ipcMain.handle('vault:createNew', (_event, payload) =>
    wrap(async () => {
      const record = asRecord(payload)
      return createNewVault(asString(record, 'name'), asString(record, 'parentPath'))
    })
  )

  ipcMain.handle('vault:open', (_event, payload) =>
    wrap(async () => openVault(asString(asRecord(payload), 'id')))
  )

  ipcMain.handle('vault:rename', (_event, payload) =>
    wrap(async () => {
      const record = asRecord(payload)
      return renameVault(asString(record, 'id'), asString(record, 'name'))
    })
  )

  ipcMain.handle('vault:remove', (_event, payload) =>
    wrap(async () => {
      const record = asRecord(payload)
      const deleteFromDisk = record.deleteFromDisk === true
      return removeVault(asString(record, 'id'), deleteFromDisk)
    })
  )

  ipcMain.handle('vault:relink', (_event, payload) =>
    wrap(async () => {
      const record = asRecord(payload)
      return relinkVault(asString(record, 'id'), asString(record, 'newPath'))
    })
  )

  ipcMain.handle('vault:revealInFileManager', (_event, payload) =>
    wrap(async () => revealVaultInFileManager(asString(asRecord(payload), 'id')))
  )

  ipcMain.handle('vault:saveSession', (_event, payload) =>
    wrap(async () => {
      const record = asRecord(payload)
      const session = record.session
      if (typeof session !== 'object' || session === null) {
        throw new VaultOpError('INVALID_INPUT', 'Missing session payload.')
      }
      return saveSessionForVault(
        asString(record, 'id'),
        session as Parameters<typeof saveSessionForVault>[1]
      )
    })
  )

  ipcMain.handle('vault:readTree', (_event, payload) =>
    wrap(async () => {
      const id = asString(asRecord(payload), 'id')
      const registry = await readRegistry()
      const vault = registry.vaults.find((v) => v.id === id)
      if (!vault) throw new VaultOpError('NOT_REGISTERED', 'This vault is not registered.')
      return scanVaultTree(vault.path)
    })
  )
}
