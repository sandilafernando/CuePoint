import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppProvider } from './state/AppState'
import './styles/app.css'

/**
 * Renderer entry point.
 *
 * React runs with context isolation and no Node integration, so the only way out of this
 * process is the `window.cuepoint` bridge installed by the preload script.
 */

const container = document.getElementById('root')
if (!container) {
  throw new Error('CuePoint could not start: the #root element is missing from index.html.')
}

createRoot(container).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
)
