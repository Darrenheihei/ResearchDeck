import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Apply the cached theme before first paint to avoid a flash. settings.json is
// the source of truth and is re-synced by VaultProvider on boot.
if (localStorage.getItem('rd-theme') === 'dark') {
  document.documentElement.classList.add('dark')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
