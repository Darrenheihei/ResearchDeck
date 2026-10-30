import type { Result, Theme, VaultErrorCode, VaultSession } from '@shared/types'

export class VaultApiError extends Error {
  constructor(
    public code: VaultErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'VaultApiError'
  }
}

async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const result = await call
  if (!result.ok) throw new VaultApiError(result.error.code, result.error.message)
  return result.data
}

export const vaultClient = {
  list: () => unwrap(window.api.vault.list()),
  open: (id: string) => unwrap(window.api.vault.open({ id })),
  createExisting: (path: string) => unwrap(window.api.vault.createExisting({ path })),
  createNew: (name: string, parentPath: string) =>
    unwrap(window.api.vault.createNew({ name, parentPath })),
  rename: (id: string, name: string) => unwrap(window.api.vault.rename({ id, name })),
  remove: (id: string, deleteFromDisk: boolean) =>
    unwrap(window.api.vault.remove({ id, deleteFromDisk })),
  relink: (id: string, newPath: string) => unwrap(window.api.vault.relink({ id, newPath })),
  reveal: (id: string) => unwrap(window.api.vault.revealInFileManager({ id })),
  saveSession: (id: string, session: VaultSession) =>
    window.api.vault.saveSession({ id, session }).catch(() => undefined),
  readTree: (id: string) => unwrap(window.api.vault.readTree({ id })),
  pickDirectory: () => window.api.dialog.pickDirectory(),
  getSettings: () => unwrap(window.api.app.getSettings()),
  setTheme: (theme: Theme) => unwrap(window.api.app.setTheme({ theme })),
  getDefaultVaultParent: () => unwrap(window.api.app.getDefaultVaultParent())
}
