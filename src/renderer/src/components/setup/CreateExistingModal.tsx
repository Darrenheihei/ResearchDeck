import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { btnGhost, btnPrimary, shortenPath } from '../../lib/ui'
import { FolderOpenIcon } from '../icons'
import { vaultClient } from '../../lib/vaultClient'
import { useVault } from '../../state/VaultContext'

interface CreateExistingModalProps {
  onClose(): void
  onDone(): void
}

export function CreateExistingModal({
  onClose,
  onDone
}: CreateExistingModalProps): React.JSX.Element {
  const { createExisting } = useVault()
  const [picked, setPicked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const choose = async (): Promise<void> => {
    setError(null)
    const path = await vaultClient.pickDirectory()
    if (path) setPicked(path)
  }

  const submit = async (): Promise<void> => {
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      await createExisting(picked)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Open an existing folder as a vault" onClose={onClose}>
      <p className="text-sm text-ink-soft">
        Pick any folder on your computer — its name becomes the vault name (renamable later).
        ResearchDeck adds a small <span className="font-mono">.researchdeck</span> folder inside to
        store vault settings.
      </p>
      <button
        type="button"
        className={`${btnGhost} mt-4 w-full justify-start`}
        onClick={() => void choose()}
      >
        <FolderOpenIcon />
        <span className="truncate">{picked ? shortenPath(picked) : 'Choose folder…'}</span>
      </button>
      {error && (
        <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={!picked || busy}
          onClick={() => void submit()}
        >
          {busy ? 'Opening…' : 'Add vault & open'}
        </button>
      </div>
    </Modal>
  )
}
