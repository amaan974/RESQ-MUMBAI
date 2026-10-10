import { useState } from 'react'
import { Ambulance, Hospital, RotateCcw, Siren, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from '../api'
import { useSim } from '../store'
import { summarize } from '../lib/derive'
import ConfirmDialog from './ConfirmDialog'

function Metric({ icon: Icon, tone, value, label, detail }: { icon: LucideIcon; tone: string; value: number; label: string; detail: string }) {
  return (
    <div className="metric card">
      <span className={`metric-icon tone-${tone}`} aria-hidden><Icon size={20} /></span>
      <div>
        <div className="metric-value num">{value}</div>
        <div className="metric-label">{label}</div>
        <div className="metric-detail">{detail}</div>
      </div>
    </div>
  )
}

export function ResetButton({ className = '' }: { className?: string }) {
  const { act, online, busy, select } = useSim()
  const [ask, setAsk] = useState(false)
  return (
    <>
      <button type="button" className={`btn ${className}`} disabled={!online || busy} onClick={() => setAsk(true)}
        title={online ? 'Restore the deterministic initial scenario' : 'Unavailable while the backend is unreachable'}>
        <RotateCcw size={16} aria-hidden /> Reset scenario
      </button>
      <ConfirmDialog open={ask} title="Reset the shared scenario?" confirmLabel="Reset scenario" danger
        onCancel={() => setAsk(false)}
        onConfirm={async () => { setAsk(false); if (await act('Scenario reset to its initial state', api.reset)) select(null) }}>
        <p>This restores the deterministic initial scenario for everyone using this backend: incidents, approvals,
          closures, hospital capacity, temporary posts and the simulation clock.</p>
      </ConfirmDialog>
    </>
  )
}

export default function OperationalSummary() {
  const { s } = useSim()
  if (!s) return null
  const m = summarize(s)
  return (
    <section className="summary" aria-label="Operational summary">
      <Metric icon={Siren} tone="critical" value={m.active} label="Active incidents"
        detail={`${m.byPriority[3]} High, ${m.byPriority[2]} Medium, ${m.byPriority[1]} Low`} />
      <Metric icon={Ambulance} tone="info" value={m.ambAvailable} label="Available ambulances"
        detail={`of ${m.ambTotal}: ${m.ambDispatched} dispatched, ${m.ambOut} off duty`} />
      <Metric icon={Hospital} tone="success" value={m.hospitalsWithBeds} label="Hospitals with beds"
        detail={`of ${m.hospitalsTotal}: ${m.bedsFree} simulated beds free`} />
      <Metric icon={TriangleAlert} tone="warning" value={m.closedEdges} label="Closed road edges"
        detail="Confirmed simulated closures" />
      <div className="summary-reset"><ResetButton /></div>
    </section>
  )
}
