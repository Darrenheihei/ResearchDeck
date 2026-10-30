import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { btnGhost, btnPrimary, inputCls, shortenPath } from '../../lib/ui'
import { vaultClient } from '../../lib/vaultClient'
import { useVault } from '../../state/VaultContext'

interface CreateNewModalProps {
  onClose(): void
  onDone(): void
}

export function CreateNewModal({ onClose, onDone }: CreateNewModalProps): React.JSX.Element {
  const { createNew } = useVault()
  const [name, setName] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    vaultClient
      .getDefaultVaultParent()
      .then((p) => {
        if (!cancelled) setParent(p)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const changeLocation = async (): Promise<void> => {
    const path = await vaultClient.pickDirectory()
    if (path) setParent(path)
  }

  const submit = async (): Promise<void> => {
    if (!name.trim() || !parent) return
    setBusy(true)
    setError(null)
    try {
      await createNew(name, parent)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Create a new vault" onClose={onClose}>
      <label className="block text-sm font-medium text-ink" htmlFor="vault-name">
        Vault name
      </label>
      <input
        id="vault-name"
        className={`${inputCls} mt-1.5`}
        placeholder="e.g. Thesis Research"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
      />

      <p className="mt-4 block text-sm font-medium text-ink">Location</p>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface-raised px-3 py-2 text-xs text-ink-soft">
          {parent ? shortenPath(parent) : 'Loading default…'}
        </span>
        <button type="button" className={btnGhost} onClick={() => void changeLocation()}>
          Change…
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-soft">
        The folder will be created inside this location if it does not exist.
      </p>

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
          disabled={!name.trim() || !parent || busy}
          onClick={() => void submit()}
        >
          {busy ? 'Creating…' : 'Create vault & open'}
        </button>
      </div>
    </Modal>
  )
}
