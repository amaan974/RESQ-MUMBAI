import { useEffect, useState } from 'react'
import { Clock, CloudRain, Menu, ShieldCheck, TriangleAlert, Wifi, WifiOff } from 'lucide-react'
import { useSim } from '../store'
import { fmtClock } from '../lib/derive'

export default function TopBar({ title, subtitle, onMenu }: { title: string; subtitle: string; onMenu: () => void }) {
  const { s, lastOkAt, online, error } = useSim()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  const age = lastOkAt ? Math.max(0, Math.round((now - lastOkAt) / 1000)) : null
  const w = s?.weather

  return (
    <header className="topbar">
      <button type="button" className="icon-btn menu-btn" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
      <div className="topbar-title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="topbar-status" role="status" aria-live="polite">
        {s && (
          <span className="chip" title="Simulation clock. Advances only when the dispatcher advances it.">
            <Clock size={14} aria-hidden /> <span className="sr-only">Simulation clock</span><b className="num">{fmtClock(s.sim_time_s)}</b>
          </span>
        )}
        {s && (
          s.plan.proven_optimal === false
            ? <span className="chip chip-warn" title="Search limit reached; showing the best feasible plan found.">
                <TriangleAlert size={14} aria-hidden /> Plan v{s.plan.version}: optimality not proven
              </span>
            : <span className="chip" title={`Exact branch-and-bound, ${s.plan.compute_ms} ms, ${s.plan.nodes_explored} search nodes`}>
                <ShieldCheck size={14} aria-hidden /> Plan v{s.plan.version}: proven optimal
              </span>
        )}
        {s && (
          w?.status === 'ok'
            ? <span className="chip chip-rain" title={`${w.source}. ${w.note}`}>
                <CloudRain size={14} aria-hidden /> Rain {w.next_6h_precip_mm} mm next 6 h (forecast, context only)
              </span>
            : <span className="chip chip-muted chip-rain" title={w?.reason}><CloudRain size={14} aria-hidden /> Rainfall: not connected</span>
        )}
        {online
          ? <span className="chip chip-ok"><Wifi size={14} aria-hidden /> Synced <span className="num">{age}s</span> ago</span>
          : <span className="chip chip-bad" title={error ?? undefined}><WifiOff size={14} aria-hidden /> {s ? 'Connection lost' : 'Connecting'}</span>}
      </div>
    </header>
  )
}
