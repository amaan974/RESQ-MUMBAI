import { Minus, Plus } from 'lucide-react'
import { api, type State } from '../api'
import { useSim } from '../store'
import { PHASE_LABEL, fmtMin } from '../lib/derive'

export function HospitalCapacity({ s, editable, highlight }: { s: State; editable: boolean; highlight?: string | null }) {
  const { act, online, busy } = useSim()
  const off = !online || busy
  const live = s.decisions.filter((d) => d.status === 'recommended' || d.status === 'approved')
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">Hospital capacity (simulated beds)</caption>
        <thead>
          <tr><th scope="col">Hospital</th><th scope="col">Beds free</th><th scope="col">Accepts</th><th scope="col">Planned</th>{editable && <th scope="col"><span className="sr-only">Actions</span></th>}</tr>
        </thead>
        <tbody>
          {s.hospitals.map((h) => {
            const planned = live.filter((d) => d.hospital_id === h.id && d.status === 'recommended').length
            return (
              <tr key={h.id} className={h.id === highlight ? 'row-hl' : ''}>
                <td><b>{h.name}</b><div className="muted small">{h.id}{h.temporary ? ', temporary post (simulated)' : h.osm_mapped ? ', OSM-mapped location' : ''}</div></td>
                <td className={`num ${h.beds_available === 0 ? 'bad-text' : ''}`}>{h.beds_available} / {h.beds_total}{h.beds_available === 0 ? ' (full)' : ''}</td>
                <td className="small">{h.eligible_types.join(', ').replace(/_/g, ' ')}</td>
                <td className="num">{planned}</td>
                {editable && (
                  <td className="actions-cell">
                    <button type="button" className="icon-btn bordered" disabled={off || h.beds_available <= 0} aria-label={`Remove one bed at ${h.id}`}
                      onClick={() => act(`${h.id}: ${h.beds_available - 1} simulated beds free`, () => api.setCapacity(h.id, h.beds_available - 1))}><Minus size={14} /></button>
                    <button type="button" className="icon-btn bordered" disabled={off} aria-label={`Add one bed at ${h.id}`}
                      onClick={() => act(`${h.id}: ${Math.max(0, h.beds_available) + 1} simulated beds free`, () => api.setCapacity(h.id, Math.max(0, h.beds_available) + 1))}><Plus size={14} /></button>
                    <button type="button" className="btn btn-sm btn-danger-outline" disabled={off || h.beds_available === 0}
                      onClick={() => act(`${h.id} set to full`, () => api.fillHospital(h.id))}>Set full</button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function AmbulanceFleet({ s }: { s: State }) {
  const live = s.decisions.filter((d) => d.status === 'recommended' || d.status === 'approved')
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">Ambulance fleet (simulated)</caption>
        <thead><tr><th scope="col">Unit</th><th scope="col">Status</th><th scope="col">Base</th><th scope="col">Assignment</th><th scope="col">To patient</th></tr></thead>
        <tbody>
          {s.ambulances.map((a) => {
            const d = live.find((x) => x.ambulance_id === a.id)
            return (
              <tr key={a.id}>
                <td><b>{a.id}</b></td>
                <td><span className={`badge amb-${a.status}`}>{a.status.replace(/_/g, ' ')}</span></td>
                <td>{a.label}</td>
                <td>{d ? <>{d.incident_id}, {d.status === 'approved' ? (d.phase ? PHASE_LABEL[d.phase] : 'approved') : 'recommended, awaiting approval'}{d.blocked ? '. Holding before a closure' : ''}</> : <span className="muted">Idle</span>}</td>
                <td className="num">{d ? fmtMin(d.estimated_ambulance_time_s) : <span className="muted">n/a</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
