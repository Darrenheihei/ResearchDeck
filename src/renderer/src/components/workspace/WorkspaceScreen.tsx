import { useRef, useState } from 'react'
import type { VaultNode } from '@shared/types'
import { useVault } from '../../state/VaultContext'
import { baseName, btnIcon, humanSize } from '../../lib/ui'
import { TabBar } from './TabBar'
import { FileTree } from './FileTree'
import { VaultSwitcher } from './VaultSwitcher'
import { ChevronLeftIcon, FileIcon, FolderIcon, MoonIcon, RefreshIcon, SunIcon } from '../icons'

interface WorkspaceScreenProps {
  onManage(): void
}

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 520
const SIDEBAR_DEFAULT = 288
const SIDEBAR_RAIL = 44

function findNode(node: VaultNode, relPath: string): VaultNode | null {
  if (node.path === relPath) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, relPath)
    if (found) return found
  }
  return null
}

export function WorkspaceScreen({ onManage }: WorkspaceScreenProps): React.JSX.Element | null {
  const {
    active,
    vaults,
    openVault,
    theme,
    toggleTheme,
    openFile,
    pinFile,
    pinTab,
    reorderTab,
    closeTab,
    activateTab,
    refreshTree
  } = useVault()
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => localStorage.getItem('rd-sidebar-collapsed') === '1'
  )
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem('rd-sidebar-width'))
    return Number.isFinite(stored) && stored >= SIDEBAR_MIN && stored <= SIDEBAR_MAX
      ? stored
      : SIDEBAR_DEFAULT
  })
  const resizeDrag = useRef<{ startX: number; startWidth: number } | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  const collapseSidebar = (): void => {
    setSidebarCollapsed(true)
    localStorage.setItem('rd-sidebar-collapsed', '1')
  }

  const expandSidebar = (): void => {
    setSidebarCollapsed(false)
    localStorage.setItem('rd-sidebar-collapsed', '0')
  }

  const persistWidth = (width: number): void => {
    localStorage.setItem('rd-sidebar-width', String(width))
  }

  const startResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    setIsResizing(true)
    resizeDrag.current = { startX: e.clientX, startWidth: sidebarWidth }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const moveResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = resizeDrag.current
    if (!drag) return
    const next = Math.min(
      SIDEBAR_MAX,
      Math.max(SIDEBAR_MIN, drag.startWidth + (e.clientX - drag.startX))
    )
    setSidebarWidth(next)
  }

  const endResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizeDrag.current) return
    resizeDrag.current = null
    setIsResizing(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    persistWidth(sidebarWidth)
  }

  const resetSidebarWidth = (): void => {
    setSidebarWidth(SIDEBAR_DEFAULT)
    persistWidth(SIDEBAR_DEFAULT)
  }

  if (!active) return null
  const activeTab = active.session.tabs.find((t) => t.id === active.session.activeTabId) ?? null
  const activeNode = activeTab ? findNode(active.tree.root, activeTab.relPath) : null

  return (
    <div className="flex h-screen flex-col bg-surface text-ink">
      {/* Top bar: empty region (same width as the expanded sidebar, separator
          on its right) + the tab strip. The whole strip drags the window. */}
      <div className="drag-region flex h-9 shrink-0 items-stretch">
        <div
          className="drag-region shrink-0 border-b border-r border-line bg-surface-raised"
          style={{ width: sidebarWidth }}
        />
        <div className="flex min-w-0 flex-1 items-stretch">
          <TabBar
            tabs={active.session.tabs}
            activeTabId={active.session.activeTabId}
            onSelect={activateTab}
            onClose={closeTab}
            onPinTab={pinTab}
            onReorderTab={reorderTab}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`relative flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface-raised motion-reduce:transition-none ${
            isResizing ? '' : 'transition-[width] duration-200 ease-in-out'
          }`}
          style={{ width: sidebarCollapsed ? SIDEBAR_RAIL : sidebarWidth }}
        >
          {/* Expanded tree — fixed width so it clips (instead of reflowing) while animating. */}
          <div
            className={`flex min-h-0 flex-1 flex-col transition-opacity duration-200 ${
              sidebarCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
            }`}
            style={{ width: sidebarWidth }}
          >
            {/* Top-left region left empty — reserved for the macOS window
                controls; also draggable for moving the window. */}
            <div className="flex items-center justify-end gap-0.5 px-3 pb-1">
              <button
                type="button"
                className={btnIcon}
                onClick={() => void refreshTree()}
                title="Refresh file tree"
              >
                <RefreshIcon />
              </button>
              <button
                type="button"
                className={btnIcon}
                onClick={collapseSidebar}
                title="Hide file tree"
              >
                <ChevronLeftIcon />
              </button>
            </div>
            {active.tree.truncated && (
              <p className="px-3 pb-1 text-[11px] text-danger">
                Listing truncated (depth/size cap). Use Refresh after reorganizing.
              </p>
            )}
            <div className="min-h-0 flex-1 overflow-auto p-1">
              <FileTree
                tree={active.tree}
                activeRelPath={activeTab?.relPath ?? null}
                onOpenFile={openFile}
                onPinFile={pinFile}
              />
            </div>
            <div className="flex items-center gap-2 border-t border-line px-3 py-2">
              <div className="min-w-0 flex-1">
                <VaultSwitcher
                  variant="full"
                  direction="up"
                  vaults={vaults}
                  activeVaultId={active.vault.id}
                  activeName={active.vault.name}
                  onOpenVault={(id) => void openVault(id)}
                  onManage={onManage}
                />
              </div>
              <button
                type="button"
                className={btnIcon}
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </button>
            </div>
          </div>
          {/* Collapsed rail — just the expand control; the settings part
              collapses away together with the tree. */}
          <div
            className={`drag-region absolute left-0 top-0 flex h-full w-11 flex-col items-center pt-2 transition-opacity duration-200 ${
              sidebarCollapsed ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <button
              type="button"
              title="Show file tree"
              onClick={expandSidebar}
              className="no-drag flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-accent-soft hover:text-accent"
            >
              <FolderIcon className="h-5 w-5" />
            </button>
            <div className="mt-auto flex w-full flex-col items-center gap-1 pb-2">
              <VaultSwitcher
                variant="icon"
                direction="right"
                vaults={vaults}
                activeVaultId={active.vault.id}
                activeName={active.vault.name}
                onOpenVault={(id) => void openVault(id)}
                onManage={onManage}
              />
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-accent-soft hover:text-accent"
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </button>
            </div>
          </div>
          {/* Invisible resize boundary — overlays the sidebar's right edge so the
              tab bar sits flush against the sidebar (no spacer gap). */}
          {!sidebarCollapsed && (
            <div
              className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize"
              onPointerDown={startResize}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onDoubleClick={resetSidebarWidth}
              title="Drag to resize — double-click to reset"
            />
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="min-h-0 flex-1 overflow-auto p-8">
            {activeTab ? (
              <div className="mx-auto max-w-xl rounded-xl border border-line bg-surface-raised p-6">
                <div className="flex items-center gap-3">
                  <FileIcon className="h-6 w-6 text-accent" />
                  <h2 className="truncate text-lg font-semibold text-ink">
                    {baseName(activeTab.relPath)}
                  </h2>
                </div>
                <p className="mt-3 font-mono text-xs break-all text-ink-soft">
                  {activeTab.relPath}
                </p>
                <p className="mt-1 text-xs text-ink-soft">Size: {humanSize(activeNode?.size)}</p>
                <p className="mt-4 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">
                  The file viewer is coming soon — tabs and session restore are already fully
                  functional.
                </p>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ink-soft">
                Select a file in the sidebar to open it in a tab.
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
