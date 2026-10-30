import { useState } from 'react'
import { VaultProvider, useVault } from './state/VaultContext'
import { SetupScreen } from './components/setup/SetupScreen'
import { WorkspaceScreen } from './components/workspace/WorkspaceScreen'

function Shell(): React.JSX.Element {
  const { ready, active } = useVault()
  const [manageMode, setManageMode] = useState(false)

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface text-sm text-ink-soft">
        Loading…
      </div>
    )
  }

  if (active && !manageMode) {
    return <WorkspaceScreen onManage={() => setManageMode(true)} />
  }

  return <SetupScreen hasActive={active !== null} onWorkspace={() => setManageMode(false)} />
}

export default function App(): React.JSX.Element {
  return (
    <VaultProvider>
      <Shell />
    </VaultProvider>
  )
}
