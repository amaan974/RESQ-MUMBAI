import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Construction, FastForward, Play, Plus, RefreshCw, RotateCcw } from 'lucide-react'
import { api } from '../api'
import { useSim } from '../store'
import { PHASE_LABEL, activeIncidents, decisionFor, fmtClock, pickSelected, sortQueue } from '../lib/derive'
import MapView, { LayerPanel } from '../MapView'
import { DEFAULT_LAYERS, type Layers } from '../lib/map'
import ConfirmDialog from '../components/ConfirmDialog'
import { HospitalCapacity } from '../components/Resources'
import { ResetButton } from '../components/OperationalSummary'

type Ask = null | 'zone' | 'reopen'

export default function DisasterSimulation() {
  const { s, act, online, busy, selectedId, select } = useSim()
  const [layers, setLayers] = useState<Layers>({ ...DEFAULT_LAYERS, flood: true })
  const [zone, setZone] = useState('FZ-1')
  const [ask, setAsk] = useState<Ask>(null)
  if (!s) return null
  const off = !online || busy
  const offTitle = online ? undefined : 'Unavailable while the backend is unreachable'

  const live = s.decisions.filter((x) => x.status === 'recommended' || x.status === 'approved')
  const sel = decisionFor(s, pickSelected(sortQueue(activeIncidents(s), 'priority'), selectedId))
  const target = sel ?? live[0] ?? null
  const approvedUnits = s.decisions.filter((x) => x.status === 'approved')
  const closedNames = [...new Set(s.closed_edges.map((e) => e.name ?? 'unnamed road'))]
  const zoneObj = s.flood_zones.find((z) => z.id === zone)

  return (
    <div className="sim-grid">
      <section className="card map-card sim-map" aria-label="Scenario map">
        <div className="map-wrap">
          <MapView s={s} selected={target} selectedIncidentId={target?.incident_id ?? null} layers={layers} onSelectIncident={select} />
          <LayerPanel layers={layers} onChange={setLayers} />
        </div>
      </section>

      <div className="sim-controls">
        <section className="card" aria-labelledby="ev-h">
          <div className="card-head"><h2 id="ev-h">Scenario events</h2></div>
          <p className="muted small">Adds demand from the deterministic scenario list. Citizen requests come from the <a href="/sos" target="_blank" rel="noopener">SOS page</a>.</p>
          <div className="btn-row">
            <button type="button" className="btn" disabled={off} title={offTitle} onClick={() => act('Simulated emergency added', api.addIncident)}><Plus size={16} aria-hidden /> Add simulated emergency</button>
            <button type="button" className="btn" disabled={off} title={offTitle} onClick={() => act('Re-optimised from current backend state', api.optimize)}><RefreshCw size={16} aria-hidden /> Optimize now</button>
          </div>
        </section>

        <section className="card" aria-labelledby="clk-h">
          <div className="card-head"><h2 id="clk-h">Simulation clock</h2><span className="chip"><Clock size={14} aria-hidden /> <b className="num">{fmtClock(s.sim_time_s)}</b></span></div>
          <p className="muted small">Moves approved units along their approved routes. Units never drive onto a closed road; they hold at the last point where a detour exists.</p>
          <div className="btn-row">
            <button type="button" className="btn" disabled={off} title={offTitle} onClick={() => act('Clock advanced 1 minute', () => api.advance(60))}><Play size={16} aria-hidden /> Advance 1 min</button>
            <button type="button" className="btn" disabled={off} title={offTitle} onClick={() => act('Clock advanced 5 minutes', () => api.advance(300))}><FastForward size={16} aria-hidden /> Advance 5 min</button>
          </div>
          {approvedUnits.length > 0 ? (
            <ul className="plain-list">
              {approvedUnits.map((x) => (
                <li key={x.id}><b>{x.ambulance_id}</b> to {x.incident_id}: {x.phase ? PHASE_LABEL[x.phase] : 'approved'}{x.blocked ? '. Holding before a closed road' : ''}</li>
              ))}
            </ul>
          ) : <p className="muted small">No approved dispatches are moving. Approve one in the <Link to="/">Dispatch Center</Link>.</p>}
        </section>

        <section className="card" aria-labelledby="rc-h">
          <div className="card-head"><h2 id="rc-h"><Construction size={18} aria-hidden /> Road closures</h2><span className="muted small num">{s.closed_edges.length} closed edges</span></div>
          <h3 className="section-label">On a dispatch route</h3>
          {live.length === 0 ? <p className="muted small">No recommended or approved dispatch to close a road on.</p> : (
            <>
              <label className="field">
                <span>Dispatch</span>
                <select value={target?.incident_id ?? ''} onChange={(e) => select(e.target.value)}>
                  {live.map((x) => <option key={x.id} value={x.incident_id}>{x.incident_id}: {x.ambulance_id} to {x.hospital_id} ({x.status})</option>)}
                </select>
              </label>
              {target && (
                <>
                  <div className="btn-row">
                    <button type="button" className="btn btn-danger-outline" disabled={off || !target.route_to_incident.edge_ids.length} title={offTitle}
                      onClick={() => act('Road closed on the route to the patient', () => api.closeOnDecision(target.id, 'to_incident'))}>Close road on route to patient</button>
                    <button type="button" className="btn btn-danger-outline" disabled={off || !target.route_to_hospital.edge_ids.length} title={offTitle}
                      onClick={() => act('Road closed on the route to the hospital', () => api.closeOnDecision(target.id, 'to_hospital'))}>Close road on route to hospital</button>
                  </div>
                  <details className="disclosure">
                    <summary>Close a specific segment ({target.route_to_incident.segments.length + target.route_to_hospital.segments.length})</summary>
                    <ul className="seg-actions">
                      {[...target.route_to_incident.segments.map((g) => ({ ...g, leg: 'To patient' })), ...target.route_to_hospital.segments.map((g) => ({ ...g, leg: 'To hospital' }))].map((g, i) => (
                        <li key={i}>
                          <span><span className="seg-leg">{g.leg}</span> {g.name} <span className="muted num">{Math.round(g.length_m)} m</span></span>
                          <button type="button" className="btn btn-sm btn-danger-outline" disabled={off} onClick={() => act(`Closed ${g.name}`, () => api.closeEdges(g.edge_ids))}>Close</button>
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              )}
            </>
          )}
          <h3 className="section-label">Hypothetical flood zone</h3>
          <div className="field-row">
            <label className="field">
              <span>Zone</span>
              <select value={zone} onChange={(e) => setZone(e.target.value)}>
                {s.flood_zones.map((z) => <option key={z.id} value={z.id}>{z.id}: {z.name}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-danger-outline" disabled={off} title={offTitle} onClick={() => setAsk('zone')}>Confirm closures in zone</button>
          </div>
          <p className="muted small">Zones are hypothetical and never close roads on their own. Rainfall data never closes roads.</p>
          <h3 className="section-label">Currently closed</h3>
          {closedNames.length ? <p className="small">{closedNames.join(', ')}</p> : <p className="muted small">No confirmed closures.</p>}
          <button type="button" className="btn" disabled={off || !s.closed_edges.length} title={offTitle} onClick={() => setAsk('reopen')}><RotateCcw size={16} aria-hidden /> Reopen all roads</button>
        </section>

        <section className="card" aria-labelledby="hc-h">
          <div className="card-head"><h2 id="hc-h">Hospital capacity (simulated)</h2></div>
          <p className="muted small">Changing beds replans every unapproved recommendation. Approved admissions already hold their bed.</p>
          <HospitalCapacity s={s} editable highlight={target?.hospital_id} />
        </section>

        <section className="card" aria-labelledby="rs-h">
          <div className="card-head"><h2 id="rs-h">Reset</h2></div>
          <p className="muted small">Restores the deterministic initial scenario for everyone using this backend.</p>
          <ResetButton />
        </section>
      </div>

      <ConfirmDialog open={ask === 'zone'} title={`Confirm closures in ${zone}?`} confirmLabel="Close roads in zone" danger
        onCancel={() => setAsk(null)}
        onConfirm={() => { setAsk(null); void act(`Closures confirmed in ${zone}`, () => api.floodZone(zone)) }}>
        <p>Every road edge inside <b>{zoneObj?.name}</b> (radius {zoneObj?.radius_m} m) becomes a confirmed simulated closure, in both directions.
          Unapproved recommendations are replanned; approved dispatches are flagged for review, not changed.</p>
      </ConfirmDialog>
      <ConfirmDialog open={ask === 'reopen'} title="Reopen all roads?" confirmLabel="Reopen all roads"
        onCancel={() => setAsk(null)}
        onConfirm={() => { setAsk(null); void act('All roads reopened', api.reopen) }}>
        <p>All {s.closed_edges.length} closed directed edges reopen and the backend replans unapproved recommendations.</p>
      </ConfirmDialog>
    </div>
  )
}
