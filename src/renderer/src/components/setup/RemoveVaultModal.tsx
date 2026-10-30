import { useState } from 'react'
import type { VaultSummary } from '@shared/types'
import { Modal } from '../ui/Modal'
import { btnGhost, btnDanger, inputCls } from '../../lib/ui'
import { useVault } from '../../state/VaultContext'

interface RemoveVaultModalProps {
  target: VaultSummary
  onClose(): void
  onDone(): void
}

export function RemoveVaultModal({
  target,
  onClose,
  onDone
}: RemoveVaultModalProps): React.JSX.Element {
  const { removeVault } = useVault()
  const [deleteFromDisk, setDeleteFromDisk] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirmNeeded = deleteFromDisk
  const canSubmit = !confirmNeeded || confirmText === target.name

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await removeVault(target.id, deleteFromDisk)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Remove vault" onClose={onClose}>
      <p className="text-sm text-ink-soft">
        Remove <span className="font-medium text-ink">{target.name}</span> from your vault list?
        {deleteFromDisk
          ? ' The folder and everything inside it will be permanently deleted.'
          : ' Your files stay exactly where they are.'}
      </p>
      <p className="mt-2 rounded-lg bg-surface-raised px-3 py-2 font-mono text-xs break-all text-ink-soft">
        {target.path}
      </p>

      <label className="mt-4 flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-danger"
          checked={deleteFromDisk}
          onChange={(e) => setDeleteFromDisk(e.target.checked)}
        />
        <span>Also delete the vault folder and all of its contents from disk</span>
      </label>

      {confirmNeeded && (
        <div className="mt-3">
          <label className="block text-xs font-medium text-danger" htmlFor="remove-confirm">
            Type “{target.name}” to confirm deletion
          </label>
          <input
            id="remove-confirm"
            className={`${inputCls} mt-1.5`}
            value={confirmText}
            autoFocus
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={btnDanger}
          disabled={!canSubmit || busy}
          onClick={() => void submit()}
        >
          {busy ? 'Removing…' : deleteFromDisk ? 'Delete folder & remove' : 'Remove from list'}
        </button>
      </div>
    </Modal>
  )
}
