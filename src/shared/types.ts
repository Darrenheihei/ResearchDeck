export type Theme = 'light' | 'dark'

export interface AppSettings {
  version: 1
  theme: Theme
}

export type VaultStatus = 'ok' | 'missing'

export interface VaultSummary {
  id: string
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string
  status: VaultStatus
}

export interface SessionTab {
  id: string
  /** Path relative to the vault root, POSIX separators. */
  relPath: string
  /** Preview tabs (italic, not pinned) are replaced by the next previewed file. */
  pinned: boolean
}

export interface VaultSession {
  version: 1
  tabs: SessionTab[]
  activeTabId: string | null
}

export interface VaultNode {
  name: string
  /** Relative to the vault root, POSIX separators; '' is the root itself. */
  path: string
  kind: 'file' | 'directory'
  size?: number
  children?: VaultNode[]
}

export interface VaultTree {
  root: VaultNode
  truncated: boolean
}

export type VaultErrorCode =
  | 'NOT_FOUND'
  | 'NOT_A_DIRECTORY'
  | 'NOT_READABLE'
  | 'NOT_WRITABLE'
  | 'ALREADY_A_VAULT'
  | 'OVERLAPS_EXISTING_VAULT'
  | 'ALREADY_EXISTS'
  | 'INVALID_NAME'
  | 'NOT_REGISTERED'
  | 'INVALID_INPUT'
  | 'UNKNOWN'

export interface VaultError {
  code: VaultErrorCode
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: VaultError }

export interface VaultListResult {
  vaults: VaultSummary[]
  lastVaultId: string | null
}

export interface OpenVaultResult {
  vault: VaultSummary
  session: VaultSession
  tree: VaultTree
}

export interface ResearchDeckApi {
  app: {
    getSettings(): Promise<Result<AppSettings>>
    setTheme(payload: { theme: Theme }): Promise<Result<AppSettings>>
    getDefaultVaultParent(): Promise<Result<string>>
  }
  dialog: {
    pickDirectory(): Promise<string | null>
  }
  vault: {
    list(): Promise<Result<VaultListResult>>
    createExisting(payload: { path: string }): Promise<Result<VaultSummary>>
    createNew(payload: { name: string; parentPath: string }): Promise<Result<VaultSummary>>
    open(payload: { id: string }): Promise<Result<OpenVaultResult>>
    rename(payload: { id: string; name: string }): Promise<Result<VaultSummary>>
    remove(payload: { id: string; deleteFromDisk: boolean }): Promise<Result<null>>
    relink(payload: { id: string; newPath: string }): Promise<Result<VaultSummary>>
    revealInFileManager(payload: { id: string }): Promise<Result<null>>
    saveSession(payload: { id: string; session: VaultSession }): Promise<Result<null>>
    readTree(payload: { id: string }): Promise<Result<VaultTree>>
    readFile(payload: { id: string; relPath: string }): Promise<Result<Uint8Array>>
  }
}
