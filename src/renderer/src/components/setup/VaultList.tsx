import { useState } from 'react'
import type { VaultSummary } from '@shared/types'
import { useVault } from '../../state/VaultContext'
import { btnGhost, btnIcon, btnPrimary, shortenPath } from '../../lib/ui'
import { vaultClient } from '../../lib/vaultClient'
import { FolderOpenIcon, LinkIcon, PencilIcon, TrashIcon } from '../icons'

interface VaultListProps {
  onOpened(): void
  onRename(target: VaultSummary): void
  onRemove(target: VaultSummary): void
}

export function VaultList({ onOpened, onRename, onRemove }: VaultListProps): React.JSX.Element {
  const { vaults, active, setBanner, openVault, relinkVault } = useVault()
  const [busyId, setBusyId] = useState<string | null>(null)

  const handleOpen = async (id: string): Promise<void> => {
    setBusyId(id)
    const opened = await openVault(id)
    setBusyId(null)
    if (opened) onOpened()
  }

  const handleRelink = async (vault: VaultSummary): Promise<void> => {
    setBusyId(vault.id)
    setBanner(null)
    try {
      const path = await vaultClient.pickDirectory()
      if (path) await relinkVault(vault.id, path)
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusyId(null)
    }
  }

  const handleReveal = async (vault: VaultSummary): Promise<void> => {
    try {
      await vaultClient.reveal(vault.id)
    } catch (err) {
      setBanner({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <ul className="space-y-2">
      {vaults.map((vault) => (
        <li
          key={vault.id}
          className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
        >
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${vault.status === 'ok' ? 'bg-ok' : 'bg-danger'}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{vault.name}</span>
              {vault.id === active?.vault.id && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
                  open
                </span>
              )}
              {vault.status === 'missing' && (
                <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-medium text-danger">
                  folder missing
                </span>
              )}
            </div>
            <p className="truncate text-xs text-ink-soft">{shortenPath(vault.path)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {vault.status === 'missing' ? (
              <button
                type="button"
                className={btnGhost}
                disabled={busyId === vault.id}
                onClick={() => void handleRelink(vault)}
              >
                <LinkIcon /> Relink…
              </button>
            ) : (
              <button
                type="button"
                className={btnPrimary}
                disabled={busyId === vault.id}
                onClick={() => void handleOpen(vault.id)}
              >
                {busyId === vault.id ? 'Opening…' : 'Open'}
              </button>
            )}
            {vault.status === 'ok' && (
              <button
                type="button"
                className={btnIcon}
                title="Open folder in Finder / file explorer"
                onClick={() => void handleReveal(vault)}
              >
                <FolderOpenIcon />
              </button>
            )}
            <button
              type="button"
              className={btnIcon}
              title="Rename vault"
              onClick={() => onRename(vault)}
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              className={btnIcon}
              title="Remove vault"
              onClick={() => onRemove(vault)}
            >
              <TrashIcon />
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
