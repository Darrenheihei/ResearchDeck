import { useRef, useState } from 'react'
import type { VaultSummary } from '@shared/types'
import { btnGhost } from '../../lib/ui'
import { ChevronDownIcon, FolderIcon } from '../icons'

interface VaultSwitcherProps {
  vaults: VaultSummary[]
  activeVaultId: string | null
  activeName: string | null
  onOpenVault(id: string): void
  onManage(): void
  variant?: 'full' | 'icon'
  /** Where the vault list opens relative to the button. */
  direction?: 'up' | 'right'
}

export function VaultSwitcher({
  vaults,
  activeVaultId,
  activeName,
  onOpenVault,
  onManage,
  variant = 'full',
  direction = 'up'
}: VaultSwitcherProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  const toggle = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      // Fixed positioning escapes the sidebar's overflow clipping.
      setPosition(
        direction === 'right'
          ? { left: rect.right + 8, bottom: window.innerHeight - rect.bottom }
          : { left: rect.left, bottom: window.innerHeight - rect.top + 6 }
      )
    }
    setOpen(true)
  }

  const itemClasses =
    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="relative">
      {variant === 'full' ? (
        <button
          ref={buttonRef}
          type="button"
          title="Switch vault"
          className={`${btnGhost} w-full justify-between`}
          onClick={toggle}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                activeVaultId === null ||
                vaults.find((v) => v.id === activeVaultId)?.status !== 'ok'
                  ? 'bg-danger'
                  : 'bg-ok'
              }`}
            />
            <span className="truncate">{activeName ?? 'Vaults'}</span>
          </span>
          <ChevronDownIcon />
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          title={activeName ? `Switch vault — ${activeName}` : 'Switch vault'}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-accent-soft hover:text-accent"
          onClick={toggle}
        >
          <FolderIcon className="h-5 w-5" />
        </button>
      )}
      {open && position && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-72 rounded-xl border border-line bg-surface p-1 shadow-xl"
            style={{ left: position.left, bottom: position.bottom }}
          >
            {vaults.map((vault) => (
              <button
                key={vault.id}
                type="button"
                disabled={vault.status === 'missing'}
                onClick={() => {
                  setOpen(false)
                  onOpenVault(vault.id)
                }}
                className={itemClasses}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    vault.status === 'ok' ? 'bg-ok' : 'bg-danger'
                  }`}
                />
                <span className="truncate">{vault.name}</span>
                {vault.id === activeVaultId && (
                  <span className="ml-auto text-[11px] text-ink-soft">current</span>
                )}
              </button>
            ))}
            <div className="my-1 border-t border-line" />
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onManage()
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-accent transition-colors hover:bg-surface-raised"
            >
              Manage vaults…
            </button>
          </div>
        </>
      )}
    </div>
  )
}
