import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// We deploy continuously; an open tab's shell can reference lazy chunks that
// no longer exist. When a chunk fails to load, reload once to pick up the new
// build instead of rendering a blank page. The guard prevents reload loops.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const key = 'chunk-reload-at'
  const last = Number(sessionStorage.getItem(key) ?? 0)
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem(key, String(Date.now()))
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
