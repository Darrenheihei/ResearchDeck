export const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50'

export const btnGhost =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50'

export const btnDanger =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-danger px-3.5 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'

export const btnIcon =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-surface-raised hover:text-ink'

export const inputCls =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft focus:border-accent focus:outline-none'

export function humanSize(bytes: number | undefined): string {
  if (bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex++
  } while (value >= 1024 && unitIndex < units.length - 1)
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

/** Last segment of a vault-relative POSIX path. */
export function baseName(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? relPath : relPath.slice(idx + 1)
}

/** True if the vault-relative path points at a PDF file. */
export function isPdfFile(relPath: string): boolean {
  return relPath.toLowerCase().endsWith('.pdf')
}

/** Formats an absolute path with a shortened middle for narrow UI. */
export function shortenPath(path: string, max = 64): string {
  if (path.length <= max) return path
  return `${path.slice(0, 24)}…${path.slice(-(max - 25))}`
}
