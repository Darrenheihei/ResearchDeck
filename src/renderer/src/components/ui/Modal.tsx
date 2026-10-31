import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { XIcon } from '../icons'

interface ModalProps {
  title: string
  onClose(): void
  children: ReactNode
  width?: string
}

export function Modal({
  title,
  onClose,
  children,
  width = 'max-w-md'
}: ModalProps): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={onClose}
    >
      <div
        className={`selectable w-full ${width} rounded-xl border border-line bg-surface p-5 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            className="text-ink-soft transition-colors hover:text-ink"
            onClick={onClose}
          >
            <XIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
