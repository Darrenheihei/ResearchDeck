import { useState } from 'react'
import type { VaultSummary } from '@shared/types'
import { Modal } from '../ui/Modal'
import { btnGhost, btnPrimary, inputCls } from '../../lib/ui'
import { useVault } from '../../state/VaultContext'

interface RenameVaultModalProps {
  target: VaultSummary
  onClose(): void
  onDone(): void
}

export function RenameVaultModal({
  target,
  onClose,
  onDone
}: RenameVaultModalProps): React.JSX.Element {
  const { renameVault } = useVault()
  const [name, setName] = useState(target.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed.length === 0 || trimmed === target.name) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await renameVault(target.id, trimmed)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Rename vault" onClose={onClose}>
      <p className="text-xs text-ink-soft">
        This changes the display name only — the folder on disk is not renamed.
      </p>
      <input
        className={`${inputCls} mt-3`}
        value={name}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
      />
      {error && (
        <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void submit()}>
          {busy ? 'Renaming…' : 'Rename'}
        </button>
      </div>
    </Modal>
  )
}
