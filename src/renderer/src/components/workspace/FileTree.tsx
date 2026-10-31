import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RESEARCH_PAPERS_DIR, type VaultNode, type VaultTree } from '@shared/types'
import { isPdfFile, isMarkdownFile } from '../../lib/ui'
import {
  BookTextIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  LibraryBigIcon,
  MarkdownIcon,
  PdfIcon
} from '../icons'

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
  researchPaths: Set<string>
  toggle(path: string): void
  activeRelPath: string | null
  onOpenFile(relPath: string): void
  onPinFile(relPath: string): void
  onHoverFile(node: VaultNode, rect: DOMRect): void
  onHoverLeave(): void
  onResearchFolderClick(node: VaultNode): void
}

function NodeRow({
  node,
  depth,
  expanded,
  researchPaths,
  toggle,
  activeRelPath,
  onOpenFile,
  onPinFile,
  onHoverFile,
  onHoverLeave,
  onResearchFolderClick
}: NodeRowProps): React.JSX.Element {
  const isDir = node.kind === 'directory'
  const isOpen = isDir && expanded.has(node.path)
  const isActive = !isDir && node.path === activeRelPath
  const isPdf = !isDir && isPdfFile(node.path)
  const isMd = !isDir && isMarkdownFile(node.path)
  // Research-paper folders live only inside the Research Papers root.
  const isResearchFolder = isDir && researchPaths.has(node.path)
  const isResearchRoot = isDir && depth === 0 && node.name === RESEARCH_PAPERS_DIR
  const indent = { paddingLeft: `${8 + depth * 14}px` }

  if (isDir) {
    const hasChildren = !!node.children && node.children.length > 0
    return (
      <div>
        <button
          type="button"
          style={indent}
          onClick={isResearchFolder ? () => onResearchFolderClick(node) : () => toggle(node.path)}
          onMouseEnter={(e) => onHoverFile(node, e.currentTarget.getBoundingClientRect())}
          onMouseLeave={onHoverLeave}
          aria-expanded={hasChildren ? isOpen : undefined}
          className="flex w-full cursor-pointer items-center gap-1 rounded-md py-1 pr-2 text-left text-sm text-ink transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        >
          <span className="text-ink-soft">
            {hasChildren ? (
              <ChevronRightIcon
                className={`h-3.5 w-3.5 transition-transform duration-200 ${
                  isOpen ? 'rotate-90' : ''
                }`}
              />
            ) : (
              <span className="inline-block h-3.5 w-3.5" />
            )}
          </span>
          {isResearchRoot ? (
            <LibraryBigIcon className="h-4 w-4 shrink-0 text-accent" />
          ) : isResearchFolder ? (
            <BookTextIcon className="h-4 w-4 shrink-0 text-accent" />
          ) : (
            <FolderIcon className="h-4 w-4 shrink-0 text-accent" />
          )}
          <span className={isResearchRoot ? 'truncate font-semibold' : 'truncate'}>
            {node.name}
          </span>
        </button>
        {hasChildren && (
          <div
            aria-hidden={!isOpen}
            inert={!isOpen}
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
              isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              {node.children?.map((child) => (
                <NodeRow
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  expanded={expanded}
                  researchPaths={researchPaths}
                  toggle={toggle}
                  activeRelPath={activeRelPath}
                  onOpenFile={onOpenFile}
                  onPinFile={onPinFile}
                  onHoverFile={onHoverFile}
                  onHoverLeave={onHoverLeave}
                  onResearchFolderClick={onResearchFolderClick}
                />
              ))}
            </div>
          </div>
        )}
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
      className={`flex w-full cursor-pointer items-center gap-1 rounded-md py-1 pr-2 text-left text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/10 ${
        isActive ? 'bg-accent-soft font-medium text-accent' : 'text-ink'
      }`}
    >
      <span className="inline-block h-3.5 w-3.5 shrink-0" />
      {isPdf ? (
        <PdfIcon className="h-4 w-4 shrink-0 text-danger" />
      ) : isMd ? (
        <MarkdownIcon className="h-4 w-4 shrink-0 text-accent" />
      ) : (
        <FileIcon className="h-4 w-4 shrink-0 text-ink-soft" />
      )}
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
  // The Research Papers root is expanded on first sight, but a manual
  // collapse by the user is respected (no re-expansion on tree refreshes).
  const autoExpanded = useRef(new Set<string>())

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

  const children = useMemo(() => tree.root.children ?? [], [tree])
  // Pin the Research Papers root above everything else (stable for the rest).
  const ordered = useMemo(
    () =>
      [...children].sort((a, b) => {
        const aResearch = a.kind === 'directory' && a.name === RESEARCH_PAPERS_DIR
        const bResearch = b.kind === 'directory' && b.name === RESEARCH_PAPERS_DIR
        return aResearch === bResearch ? 0 : aResearch ? -1 : 1
      }),
    [children]
  )

  // Default-expand the Research Papers root so the paper list is visible.
  useEffect(() => {
    const researchRoot = children.find(
      (child) => child.kind === 'directory' && child.name === RESEARCH_PAPERS_DIR
    )
    if (researchRoot && !autoExpanded.current.has(researchRoot.path)) {
      autoExpanded.current.add(researchRoot.path)
      setExpanded((prev) => new Set(prev).add(researchRoot.path))
    }
  }, [children])

  // Directories that directly contain a PDF are research paper folders —
  // but only inside the Research Papers root; elsewhere folders are plain.
  const researchPaths = useMemo(() => {
    const paths = new Set<string>()
    const walk = (node: VaultNode): void => {
      if (node.kind !== 'directory') return
      if (
        (node.path === RESEARCH_PAPERS_DIR || node.path.startsWith(`${RESEARCH_PAPERS_DIR}/`)) &&
        (node.children ?? []).some((c) => c.kind === 'file' && isPdfFile(c.path))
      ) {
        paths.add(node.path)
      }
      node.children?.forEach(walk)
    }
    walk(tree.root)
    return paths
  }, [tree])

  // Research folder click: open the notes file named exactly like the folder,
  // and expand it exclusively — at most one research folder stays expanded.
  const openResearchFolder = useCallback(
    (node: VaultNode): void => {
      const isOpen = expanded.has(node.path)
      setExpanded((prev) => {
        const next = new Set(prev)
        for (const p of researchPaths) {
          if (p !== node.path) next.delete(p)
        }
        if (isOpen) {
          next.delete(node.path)
        } else {
          next.add(node.path)
        }
        return next
      })
      const mdPath = `${node.path}/${node.name}.md`
      if ((node.children ?? []).some((c) => c.kind === 'file' && c.path === mdPath)) {
        onOpenFile(mdPath)
      }
    },
    [expanded, researchPaths, onOpenFile]
  )

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
        {ordered.map((child) => (
          <NodeRow
            key={child.path}
            node={child}
            depth={0}
            expanded={expanded}
            researchPaths={researchPaths}
            toggle={toggle}
            activeRelPath={activeRelPath}
            onOpenFile={onOpenFile}
            onPinFile={onPinFile}
            onHoverFile={showTooltip}
            onHoverLeave={hideTooltip}
            onResearchFolderClick={openResearchFolder}
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
