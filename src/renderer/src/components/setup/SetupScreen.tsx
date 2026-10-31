import { useState } from 'react'
import { useVault } from '../../state/VaultContext'
import { btnGhost, btnIcon } from '../../lib/ui'
import { FolderOpenIcon, MoonIcon, PlusIcon, SunIcon } from '../icons'
import { CreateExistingModal } from './CreateExistingModal'
import { CreateNewModal } from './CreateNewModal'
import { RenameVaultModal } from './RenameVaultModal'
import { RemoveVaultModal } from './RemoveVaultModal'
import { VaultList } from './VaultList'
import type { VaultSummary } from '@shared/types'

interface SetupScreenProps {
  hasActive: boolean
  onWorkspace(): void
}

type DialogState =
  | { kind: 'none' }
  | { kind: 'create-existing' }
  | { kind: 'create-new' }
  | { kind: 'rename'; target: VaultSummary }
  | { kind: 'remove'; target: VaultSummary }

export function SetupScreen({ hasActive, onWorkspace }: SetupScreenProps): React.JSX.Element {
  const { vaults, active, banner, setBanner, theme, toggleTheme } = useVault()
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' })
  const isMac = window.electron.process.platform === 'darwin'

  const none = { kind: 'none' } as const
  const openAfterDialog = (): void => {
    setDialog(none)
    onWorkspace()
  }

  return (
    <div className="min-h-screen bg-surface text-ink">
      <div className="selectable mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
        <div
          className={`drag-region flex h-12 items-center justify-between pr-1 ${isMac ? 'pl-24' : ''}`}
        >
          <h1 className="text-xl font-bold tracking-tight">ResearchDeck</h1>
          <button
            type="button"
            className={`${btnIcon} no-drag`}
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>

        {banner && (
          <div
            className={`mt-4 flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
              banner.kind === 'error' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
            }`}
          >
            <span>{banner.text}</span>
            <button
              type="button"
              className="ml-3 opacity-70 transition-opacity hover:opacity-100"
              onClick={() => setBanner(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {hasActive && (
          <div className="mt-6 flex items-center justify-between rounded-xl border border-line bg-surface-raised px-4 py-3">
            <span className="text-sm text-ink">
              Working in <span className="font-medium">{active?.vault.name}</span>
            </span>
            <button type="button" className={btnGhost} onClick={onWorkspace}>
              Back to workspace
            </button>
          </div>
        )}

        <div className="mt-10">
          <h2 className="text-2xl font-semibold">
            {vaults.length === 0 ? 'Welcome to ResearchDeck' : 'Your vaults'}
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            {vaults.length === 0
              ? 'A vault is a folder on your computer that holds all of your research. Everything stays local.'
              : 'Open a vault, or add another folder.'}
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:bg-surface-raised"
              onClick={() => setDialog({ kind: 'create-existing' })}
            >
              <FolderOpenIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              <span>
                <span className="block text-sm font-medium text-ink">Open existing folder…</span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  Use a folder you already have as a vault.
                </span>
              </span>
            </button>
            <button
              type="button"
              className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:bg-surface-raised"
              onClick={() => setDialog({ kind: 'create-new' })}
            >
              <PlusIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              <span>
                <span className="block text-sm font-medium text-ink">Create new vault…</span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  Pick a name and we create the folder for you.
                </span>
              </span>
            </button>
          </div>
        </div>

        {vaults.length > 0 && (
          <div className="mt-6">
            <VaultList
              onOpened={onWorkspace}
              onRename={(target) => setDialog({ kind: 'rename', target })}
              onRemove={(target) => setDialog({ kind: 'remove', target })}
            />
          </div>
        )}

        <p className="mt-auto pt-10 text-[11px] text-ink-soft">
          Local-first: your vault folders and the vault list live on this computer only.
        </p>
      </div>

      {dialog.kind === 'create-existing' && (
        <CreateExistingModal onClose={() => setDialog(none)} onDone={openAfterDialog} />
      )}
      {dialog.kind === 'create-new' && (
        <CreateNewModal onClose={() => setDialog(none)} onDone={openAfterDialog} />
      )}
      {dialog.kind === 'rename' && (
        <RenameVaultModal
          target={dialog.target}
          onClose={() => setDialog(none)}
          onDone={() => setDialog(none)}
        />
      )}
      {dialog.kind === 'remove' && (
        <RemoveVaultModal
          target={dialog.target}
          onClose={() => setDialog(none)}
          onDone={() => setDialog(none)}
        />
      )}
    </div>
  )
}
