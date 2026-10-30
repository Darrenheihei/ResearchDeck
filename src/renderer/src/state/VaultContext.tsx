import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionTab, Theme, VaultSession, VaultSummary, VaultTree } from '@shared/types'
import { vaultClient } from '@renderer/lib/vaultClient'

export interface ActiveVault {
  vault: VaultSummary
  session: VaultSession
  tree: VaultTree
}

export interface Banner {
  kind: 'error' | 'info'
  text: string
}

interface VaultContextValue {
  ready: boolean
  vaults: VaultSummary[]
  active: ActiveVault | null
  theme: Theme
  banner: Banner | null
  setBanner(banner: Banner | null): void
  toggleTheme(): void
  openVault(id: string): Promise<boolean>
  createExisting(path: string): Promise<VaultSummary>
  createNew(name: string, parentPath: string): Promise<VaultSummary>
  renameVault(id: string, name: string): Promise<VaultSummary>
  removeVault(id: string, deleteFromDisk: boolean): Promise<null>
  relinkVault(id: string, newPath: string): Promise<VaultSummary>
  openFile(relPath: string, preview?: boolean): void
  pinFile(relPath: string): void
  pinTab(tabId: string): void
  reorderTab(draggedId: string, toIndex: number): void
  closeTab(tabId: string): void
  activateTab(tabId: string): void
  refreshTree(): Promise<void>
}

const VaultContext = createContext<VaultContextValue | null>(null)

function sortVaults(vaults: VaultSummary[]): VaultSummary[] {
  return [...vaults].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem('rd-theme', theme)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function VaultProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [vaults, setVaults] = useState<VaultSummary[]>([])
  const [active, setActive] = useState<ActiveVault | null>(null)
  const [theme, setThemeState] = useState<Theme>('light')
  const [banner, setBanner] = useState<Banner | null>(null)
  const saveTimer = useRef<number | null>(null)

  const refreshList = useCallback(async (): Promise<void> => {
    const list = await vaultClient.list()
    setVaults(sortVaults(list.vaults))
  }, [])

  const openVault = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const opened = await vaultClient.open(id)
        setActive(opened)
        setBanner(null)
        await refreshList()
        return true
      } catch (err) {
        setBanner({ kind: 'error', text: errorMessage(err) })
        return false
      }
    },
    [refreshList]
  )

  // Boot: load settings + vault list, auto-open the last used vault.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const settings = await vaultClient.getSettings()
        if (!cancelled) {
          setThemeState(settings.theme)
          applyTheme(settings.theme)
        }
      } catch {
        // Fall back to the light theme / localStorage cache.
      }
      try {
        const list = await vaultClient.list()
        if (cancelled) return
        setVaults(sortVaults(list.vaults))
        const target = list.vaults.find((v) => v.id === list.lastVaultId)
        if (target && target.status === 'ok') {
          const opened = await vaultClient.open(target.id)
          if (!cancelled) setActive(opened)
        }
      } catch (err) {
        if (!cancelled) setBanner({ kind: 'error', text: errorMessage(err) })
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const toggleTheme = useCallback((): void => {
    setThemeState((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      vaultClient.setTheme(next).catch(() => undefined)
      return next
    })
  }, [])

  const persistSession = useCallback((vaultId: string, session: VaultSession): void => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void vaultClient.saveSession(vaultId, session)
    }, 500)
  }, [])

  const mutateSession = useCallback(
    (mutate: (session: VaultSession) => VaultSession): void => {
      setActive((prev) => {
        if (!prev) return prev
        const session = mutate(prev.session)
        persistSession(prev.vault.id, session)
        return { ...prev, session }
      })
    },
    [persistSession]
  )

  const openFile = useCallback(
    (relPath: string, preview = true): void => {
      mutateSession((session) => {
        const existing = session.tabs.find((t) => t.relPath === relPath)
        if (existing) {
          // Already open: activate it. A pinned tab is never downgraded to
          // preview by clicking; a preview tab stays preview.
          const tabs = preview
            ? session.tabs
            : session.tabs.map((t) => (t.id === existing.id ? { ...t, pinned: true } : t))
          return { ...session, tabs, activeTabId: existing.id }
        }
        const newTab: SessionTab = { id: uid(), relPath, pinned: !preview }
        // VS Code style: at most one preview tab. Previewing a new file
        // replaces the existing preview tab in place; otherwise the tab is
        // inserted right after the active one.
        const previewIndex = session.tabs.findIndex((t) => !t.pinned)
        let tabs: SessionTab[]
        if (preview && previewIndex !== -1) {
          tabs = session.tabs.map((t, i) => (i === previewIndex ? newTab : t))
        } else if (!preview) {
          tabs = [...session.tabs, newTab]
        } else {
          const activeIndex = session.tabs.findIndex((t) => t.id === session.activeTabId)
          tabs =
            activeIndex === -1
              ? [...session.tabs, newTab]
              : [
                  ...session.tabs.slice(0, activeIndex + 1),
                  newTab,
                  ...session.tabs.slice(activeIndex + 1)
                ]
        }
        return { ...session, tabs, activeTabId: newTab.id }
      })
    },
    [mutateSession]
  )

  const pinFile = useCallback(
    (relPath: string): void => {
      openFile(relPath, false)
    },
    [openFile]
  )

  const pinTab = useCallback(
    (tabId: string): void => {
      mutateSession((session) => ({
        ...session,
        tabs: session.tabs.map((t) => (t.id === tabId ? { ...t, pinned: true } : t))
      }))
    },
    [mutateSession]
  )

  const reorderTab = useCallback(
    (draggedId: string, toIndex: number): void => {
      mutateSession((session) => {
        const fromIndex = session.tabs.findIndex((t) => t.id === draggedId)
        if (fromIndex === -1 || toIndex < 0 || toIndex >= session.tabs.length) return session
        if (fromIndex === toIndex) return session
        const moved = session.tabs[fromIndex]
        const remaining = session.tabs.filter((_, i) => i !== fromIndex)
        const adjustedTo = toIndex > fromIndex ? toIndex - 1 : toIndex
        const insertAt = Math.max(0, Math.min(adjustedTo, remaining.length))
        const tabs = [...remaining.slice(0, insertAt), moved, ...remaining.slice(insertAt)]
        return { ...session, tabs }
      })
    },
    [mutateSession]
  )

  const closeTab = useCallback(
    (tabId: string): void => {
      mutateSession((session) => {
        const index = session.tabs.findIndex((t) => t.id === tabId)
        if (index === -1) return session
        const tabs = session.tabs.filter((t) => t.id !== tabId)
        let activeTabId = session.activeTabId
        if (session.activeTabId === tabId) {
          const neighbor = tabs[Math.min(index, tabs.length - 1)]
          activeTabId = neighbor ? neighbor.id : null
        }
        return { ...session, tabs, activeTabId }
      })
    },
    [mutateSession]
  )

  const activateTab = useCallback(
    (tabId: string): void => {
      mutateSession((session) =>
        session.tabs.some((t) => t.id === tabId) ? { ...session, activeTabId: tabId } : session
      )
    },
    [mutateSession]
  )

  const createExisting = useCallback(
    async (path: string): Promise<VaultSummary> => {
      const summary = await vaultClient.createExisting(path)
      const opened = await vaultClient.open(summary.id)
      setActive(opened)
      await refreshList()
      return summary
    },
    [refreshList]
  )

  const createNew = useCallback(
    async (name: string, parentPath: string): Promise<VaultSummary> => {
      const summary = await vaultClient.createNew(name, parentPath)
      const opened = await vaultClient.open(summary.id)
      setActive(opened)
      await refreshList()
      return summary
    },
    [refreshList]
  )

  const renameVault = useCallback(async (id: string, name: string): Promise<VaultSummary> => {
    const summary = await vaultClient.rename(id, name)
    setVaults((prev) => prev.map((v) => (v.id === id ? summary : v)))
    setActive((prev) => (prev && prev.vault.id === id ? { ...prev, vault: summary } : prev))
    return summary
  }, [])

  const removeVault = useCallback(
    async (id: string, deleteFromDisk: boolean): Promise<null> => {
      const result = await vaultClient.remove(id, deleteFromDisk)
      setActive((prev) => (prev && prev.vault.id === id ? null : prev))
      await refreshList()
      return result
    },
    [refreshList]
  )

  const relinkVault = useCallback(async (id: string, newPath: string): Promise<VaultSummary> => {
    const summary = await vaultClient.relink(id, newPath)
    setVaults((prev) => prev.map((v) => (v.id === id ? summary : v)))
    return summary
  }, [])

  const refreshTree = useCallback(async (): Promise<void> => {
    if (!active) return
    try {
      const tree = await vaultClient.readTree(active.vault.id)
      setActive((prev) => (prev && prev.vault.id === active.vault.id ? { ...prev, tree } : prev))
    } catch (err) {
      setBanner({ kind: 'error', text: errorMessage(err) })
    }
  }, [active])

  const value: VaultContextValue = {
    ready,
    vaults,
    active,
    theme,
    banner,
    setBanner,
    toggleTheme,
    openVault,
    createExisting,
    createNew,
    renameVault,
    removeVault,
    relinkVault,
    openFile,
    pinFile,
    pinTab,
    reorderTab,
    closeTab,
    activateTab,
    refreshTree
  }

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook paired with its provider
export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault must be used within VaultProvider')
  return ctx
}
