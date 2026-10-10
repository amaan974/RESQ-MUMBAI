import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { CircleCheck, CircleX, Info, WifiOff } from 'lucide-react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useSim } from '../store'

const TITLES: Record<string, [string, string]> = {
  '/': ['Dispatch Center', 'Kurla, Sion and Chunabhatti pilot area'],
  '/simulation': ['Disaster Simulation', 'Shared scenario controls. The backend replans after every change.'],
  '/resources': ['Resource Planning', 'Positioning, evacuation and temporary medical sites'],
  '/analytics': ['Analytics & Reports', 'Measured comparisons and the backend event log'],
  '/sources': ['Data & Sources', 'Real map data, simulated data and unconnected feeds'],
}

export default function AppShell() {
  const { pathname } = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  const { s, error, online, toast } = useSim()
  const [title, subtitle] = TITLES[pathname] ?? TITLES['/']

  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to main content</a>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />}
      <div className="workspace">
        <div className="sim-notice" role="note">
          <Info size={14} aria-hidden />
          Research simulation. Not for real emergency use. Does not contact emergency services. All operational data is simulated.
        </div>
        <TopBar title={title} subtitle={subtitle} onMenu={() => setNavOpen(true)} />
        {s && !online && (
          <div className="stale" role="alert">
            <WifiOff size={16} aria-hidden />
            <span>
              <b>Backend connection lost.</b> Showing the last known state. Actions are disabled until the connection returns.
              {error ? ` (${error})` : ''}
            </span>
          </div>
        )}
        <main id="main" className="page" tabIndex={-1}>
          {s ? <Outlet /> : (
            <div className={`loading ${error ? 'loading-err' : ''}`} role="status">
              {error
                ? <><b>Backend unavailable.</b> {error} The free backend can take about a minute to wake up; this page retries every 2 seconds.</>
                : 'Loading simulation state from the backend.'}
            </div>
          )}
        </main>
      </div>
      <div className="toast-region" aria-live="polite">
        {toast && (
          <div className={`toast ${toast.kind === 'err' ? 'toast-err' : ''}`}>
            {toast.kind === 'err' ? <CircleX size={16} aria-hidden /> : <CircleCheck size={16} aria-hidden />}
            {toast.text}
          </div>
        )}
      </div>
    </div>
  )
}
