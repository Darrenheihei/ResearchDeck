import { useEffect, useRef, useState } from 'react'
import type { VaultNode, VaultTree } from '@shared/types'
import { ChevronDownIcon, ChevronRightIcon, FileIcon, FolderIcon } from '../icons'

interface FileTreeProps {
  tree: VaultTree
  activeRelPath: string | null
  onOpenFile(relPath: string): void
  onPinFile(relPath: string): void
}

interface NodeRowProps {
  node: VaultNode
  depth: number
  expanded: Set<string>
  toggle(path: string): void
  activeRelPath: string | null
  onOpenFile(relPath: string): void
  onPinFile(relPath: string): void
  onHoverFile(node: VaultNode, rect: DOMRect): void
  onHoverLeave(): void
}

function NodeRow({
  node,
  depth,
  expanded,
  toggle,
  activeRelPath,
  onOpenFile,
  onPinFile,
  onHoverFile,
  onHoverLeave
}: NodeRowProps): React.JSX.Element {
  const isDir = node.kind === 'directory'
  const isOpen = isDir && expanded.has(node.path)
  const isActive = !isDir && node.path === activeRelPath
  const indent = { paddingLeft: `${8 + depth * 14}px` }

  if (isDir) {
    return (
      <div>
        <button
          type="button"
          style={indent}
          onClick={() => toggle(node.path)}
          className="flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-sm text-ink transition-colors hover:bg-surface"
        >
          <span className="text-ink-soft">
            {isOpen ? (
              <ChevronDownIcon className="h-3.5 w-3.5" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5" />
            )}
          </span>
          <FolderIcon className="h-4 w-4 shrink-0 text-accent" />
          <span className="truncate">{node.name}</span>
        </button>
        {isOpen &&
          node.children?.map((child) => (
            <NodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              activeRelPath={activeRelPath}
              onOpenFile={onOpenFile}
              onPinFile={onPinFile}
              onHoverFile={onHoverFile}
              onHoverLeave={onHoverLeave}
            />
          ))}
      </div>
    )
  }

  return (
    <button
      type="button"
      style={indent}
      onClick={() => {
        onHoverLeave()
        onOpenFile(node.path)
      }}
      onDoubleClick={() => onPinFile(node.path)}
      onMouseEnter={(e) => onHoverFile(node, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={onHoverLeave}
      className={`flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-sm transition-colors hover:bg-surface ${
        isActive ? 'bg-accent-soft font-medium text-accent' : 'text-ink'
      }`}
    >
      <span className="inline-block h-3.5 w-3.5 shrink-0" />
      <FileIcon className="h-4 w-4 shrink-0 text-ink-soft" />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

export function FileTree({
  tree,
  activeRelPath,
  onOpenFile,
  onPinFile
}: FileTreeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [tooltip, setTooltip] = useState<{ relPath: string; x: number; y: number } | null>(null)
  const tooltipTimer = useRef<number | null>(null)
  const treeRef = useRef<HTMLDivElement | null>(null)
  // Once a tooltip has been shown, hovering other files in the tree shows
  // theirs instantly; the delay only applies to the first hover after the
  // pointer re-enters the tree view.
  const tooltipArmed = useRef(false)

  const hideTooltip = (): void => {
    if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current)
    tooltipTimer.current = null
    setTooltip(null)
  }

  const showTooltip = (node: VaultNode, rect: DOMRect): void => {
    if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current)
    const delay = tooltipArmed.current ? 0 : 1000
    tooltipTimer.current = window.setTimeout(() => {
      tooltipArmed.current = true
      // Anchor the tooltip just outside the sidebar's right edge, vertically
      // aligned with the hovered row; clamp so it never runs off the window.
      const rootRight = treeRef.current?.getBoundingClientRect().right ?? rect.right
      const x = Math.max(8, Math.min(rootRight + 8, window.innerWidth - 464))
      setTooltip({
        relPath: node.path,
        x,
        y: rect.top - 4
      })
    }, delay)
  }

  useEffect(() => {
    return () => {
      if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current)
    }
  }, [tree])

  const toggle = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const children = tree.root.children ?? []
  if (children.length === 0) {
    return <p className="px-3 py-4 text-xs text-ink-soft">This folder is empty.</p>
  }

  return (
    <>
      <div
        ref={treeRef}
        onMouseLeave={(): void => {
          tooltipArmed.current = false
          hideTooltip()
        }}
      >
        {children.map((child) => (
          <NodeRow
            key={child.path}
            node={child}
            depth={0}
            expanded={expanded}
            toggle={toggle}
            activeRelPath={activeRelPath}
            onOpenFile={onOpenFile}
            onPinFile={onPinFile}
            onHoverFile={showTooltip}
            onHoverLeave={hideTooltip}
          />
        ))}
      </div>
      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 max-w-md break-all rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.relPath}
        </div>
      )}
    </>
  )
}
