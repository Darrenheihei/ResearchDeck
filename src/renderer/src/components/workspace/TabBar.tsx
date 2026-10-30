import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionTab } from '@shared/types'
import { baseName } from '../../lib/ui'
import { XIcon } from '../icons'

interface TabBarProps {
  tabs: SessionTab[]
  activeTabId: string | null
  onSelect(tabId: string): void
  onClose(tabId: string): void
  onPinTab(tabId: string): void
  onReorderTab(draggedId: string, toIndex: number): void
}

export function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onPinTab,
  onReorderTab
}: TabBarProps): React.JSX.Element {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{
    tabId: string
    side: 'before' | 'after'
  } | null>(null)
  const [tooltip, setTooltip] = useState<{
    tabId: string
    text: string
    x: number
    y: number
  } | null>(null)
  const tooltipTimer = useRef<number | null>(null)
  // Once a tooltip has been shown, further tab hovers inside the tab bar show
  // tooltips instantly; the delay only applies to the first hover after the
  // pointer re-enters the tab bar.
  const tooltipArmed = useRef(false)
  const activeTabRef = useRef<HTMLDivElement | null>(null)
  const isWin = window.electron.process.platform === 'win32'
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Electron drag regions swallow wheel events, so the tab strip is scrolled
  // manually through a non-passive listener (wheel + shift-wheel + trackpad).
  // Attached via callback ref: re-runs whenever the scroll container mounts
  // (it only exists once there are tabs).
  const attachScrollRef = useCallback((node: HTMLDivElement | null): void => {
    scrollRef.current = node
    if (!node) return
    const handler = (e: WheelEvent): void => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (delta === 0) return
      node.scrollLeft += delta
      e.preventDefault()
    }
    node.addEventListener('wheel', handler, { passive: false })
  }, [])

  const clearTooltip = (): void => {
    if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current)
    tooltipTimer.current = null
    setTooltip(null)
  }

  useEffect(() => {
    return () => {
      if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current)
    }
  }, [])

  // Keep the active tab fully visible in the strip — e.g. when it is activated
  // from the tree view, the vault switcher, or a restored session while the
  // strip is scrolled somewhere else.
  useEffect(() => {
    if (activeTabRef.current?.isConnected) {
      activeTabRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [activeTabId])

  if (tabs.length === 0) {
    return (
      <div
        className={`drag-region h-9 shrink-0 border-b border-line ${isWin ? 'pr-[140px]' : ''}`}
      />
    )
  }
  return (
    <div
      ref={attachScrollRef}
      className={`tab-strip drag-region flex h-9 min-w-0 flex-1 items-stretch overflow-x-auto bg-surface-raised ${
        isWin ? 'pr-[140px]' : ''
      }`}
      onMouseLeave={(): void => {
        tooltipArmed.current = false
        clearTooltip()
      }}
      onDragOver={(e) => {
        if (draggingId) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }
      }}
      onDrop={(e) => {
        if (draggingId) {
          e.preventDefault()
          onReorderTab(draggingId, tabs.length)
          setDropIndicator(null)
          setDraggingId(null)
        }
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        const isDragged = tab.id === draggingId
        const indicator = dropIndicator?.tabId === tab.id ? dropIndicator.side : null
        return (
          <div
            key={tab.id}
            ref={(el) => {
              if (isActive) activeTabRef.current = el
            }}
            role="tab"
            aria-selected={isActive}
            tabIndex={0}
            draggable
            onClick={() => onSelect(tab.id)}
            onDoubleClick={() => onPinTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) onClose(tab.id)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSelect(tab.id)
            }}
            onMouseEnter={(e) => {
              clearTooltip()
              const rect = e.currentTarget.getBoundingClientRect()
              const delay = tooltipArmed.current ? 0 : 1000
              tooltipTimer.current = window.setTimeout(() => {
                tooltipArmed.current = true
                setTooltip({
                  tabId: tab.id,
                  text: tab.relPath,
                  x: rect.left + rect.width / 2,
                  y: rect.bottom + 6
                })
              }, delay)
            }}
            onMouseLeave={clearTooltip}
            onDragStart={(e) => {
              clearTooltip()
              tooltipArmed.current = false
              setDraggingId(tab.id)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', tab.id)
            }}
            onDragOver={(e) => {
              if (!draggingId || draggingId === tab.id) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const rect = e.currentTarget.getBoundingClientRect()
              setDropIndicator({
                tabId: tab.id,
                side: e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
              })
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const fromId = draggingId
              setDropIndicator(null)
              setDraggingId(null)
              if (!fromId || fromId === tab.id) return
              const index = tabs.findIndex((t) => t.id === tab.id)
              const rect = e.currentTarget.getBoundingClientRect()
              const toIndex = e.clientX < rect.left + rect.width / 2 ? index : index + 1
              onReorderTab(fromId, toIndex)
            }}
            onDragEnd={(): void => {
              setDraggingId(null)
              setDropIndicator(null)
            }}
            className={`no-drag group flex max-w-52 min-w-32 shrink-0 cursor-pointer items-center justify-between gap-1 border-r border-line px-3 text-xs transition-colors ${
              isActive
                ? 'bg-surface font-medium text-ink'
                : 'border-b border-line text-ink-soft hover:bg-surface hover:text-ink'
            } ${isDragged ? 'opacity-50' : ''} ${
              indicator === 'before'
                ? 'shadow-[inset_2px_0_0_0_var(--accent)]'
                : indicator === 'after'
                  ? 'shadow-[inset_-2px_0_0_0_var(--accent)]'
                  : ''
            }`}
          >
            <span className={`truncate ${tab.pinned ? '' : 'italic'}`}>
              {baseName(tab.relPath)}
            </span>
            <button
              type="button"
              aria-label={`Close ${baseName(tab.relPath)}`}
              className={`no-drag rounded p-0.5 transition-opacity hover:bg-line ${
                isActive ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </div>
        )
      })}
      <div className="min-w-0 flex-1 border-b border-line" />
      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="relative max-w-lg rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink shadow-lg before:absolute before:-top-[5px] before:left-1/2 before:h-2 before:w-2 before:-translate-x-1/2 before:rotate-45 before:border-l before:border-t before:border-line before:bg-surface before:content-['']">
            {tooltip.text}
          </div>
        </div>
      )}
    </div>
  )
}
