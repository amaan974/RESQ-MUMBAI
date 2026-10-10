import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, TriangleAlert } from 'lucide-react'
import { api } from '../api'
import { useSim } from '../store'
import { fmtKm, fmtMin } from '../lib/derive'
import MapView, { LayerPanel } from '../MapView'
import { DEFAULT_LAYERS, type Layers } from '../lib/map'
import { AmbulanceFleet, HospitalCapacity } from '../components/Resources'

export default function ResourcePlanning() {
  const { s, act, online, busy } = useSim()
  const [layers, setLayers] = useState<Layers>({ ...DEFAULT_LAYERS, evac: true, sites: true, others: false, flood: true })
  const [origin, setOrigin] = useState<string>('EVO-1')
  if (!s) return null
  const off = !online || busy
  const offTitle = online ? undefined : 'Unavailable while the backend is unreachable'
  const pos = s.positioning
  const rec = pos.recommendation
  const ev = s.evacuation[origin]
  const shelter = ev?.shelter_id ? s.shelters.find((x) => x.id === ev.shelter_id) : null
  const c = s.clinic
  const clinicName = (id: string | null) => s.clinic_sites.find((x) => x.id === id)?.name ?? id
  const deployed = s.hospitals.filter((h) => h.temporary)
  const recDeployed = c.site_id ? s.hospitals.some((h) => h.id === `TMP-${c.site_id}`) : false

  return (
    <div className="res-grid">
      <section className="card map-card res-map" aria-label="Resource map">
        <div className="map-wrap">
          <MapView s={s} selected={null} selectedIncidentId={null} layers={layers} evacOrigin={origin} />
          <LayerPanel layers={layers} onChange={setLayers} />
        </div>
      </section>

      <section className="card" aria-labelledby="pos-h">
        <div className="card-head"><h2 id="pos-h">Ambulance positioning</h2></div>
        <dl className="kv">
          <dt>Demand covered within 5 min</dt><dd className="num"><b>{pos.covered_weight}</b> of {pos.total_weight} weighted demand</dd>
          <dt>Coverage gaps</dt><dd>{pos.gaps.length ? pos.gaps.join(', ') : 'None'}</dd>
          <dt>Idle ambulances</dt><dd>{pos.idle_ambulances.length ? pos.idle_ambulances.join(', ') : 'None'}</dd>
        </dl>
        {rec ? (
          <div className="recbox">
            <p><b>Suggested:</b> move {rec.ambulance_id} to {s.staging_sites.find((x) => x.id === rec.staging_site_id)?.name}.
              Coverage after the move: <b className="num">{rec.covered_weight_after}</b> of {pos.total_weight}.</p>
            <p className="muted small">{rec.reason}</p>
            <button type="button" className="btn btn-primary" disabled={off} title={offTitle}
              onClick={() => act(`${rec.ambulance_id} repositioned (simulated)`, () => api.applyPositioning(rec.ambulance_id, rec.staging_site_id))}>
              <Check size={16} aria-hidden /> Approve move
            </button>
          </div>
        ) : <p className="muted small">No single idle-unit move improves coverage right now.</p>}
        <p className="muted small">{pos.rule}</p>
      </section>

      <section className="card" aria-labelledby="evac-h">
        <div className="card-head"><h2 id="evac-h">Evacuation</h2></div>
        <label className="field">
          <span>Evacuation origin (scenario)</span>
          <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
            {s.evacuation_origins.map((o) => <option key={o.id} value={o.id}>{o.id}: {o.name}, {o.people} people</option>)}
          </select>
        </label>
        {ev && (ev.status === 'ok' && ev.route ? (
          <div className="recbox">
            <p><b>{shelter?.name}</b></p>
            <p>Road route <b className="num">{fmtMin(ev.route.travel_time_s)}</b> <span className="num">({fmtKm(ev.route.length_m)}, {ev.route.edge_ids.length} edges)</span>. Recomputed after every closure.</p>
            <p className="muted small">{ev.reason}</p>
            {ev.alternatives && ev.alternatives.length > 0 && (
              <p className="muted small">Other feasible shelters: {ev.alternatives.map((a) => `${a.shelter_id} (${fmtMin(a.time_s)})`).join(', ')}</p>
            )}
          </div>
        ) : (
          <div className="notice notice-critical" role="status">
            <TriangleAlert size={18} aria-hidden />
            <div><b>No feasible evacuation route</b><p>{ev.reason}</p></div>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="tmp-h">
        <div className="card-head"><h2 id="tmp-h">Temporary medical resources</h2></div>
        <p>{c.site_id ? <><b>Recommended: {clinicName(c.site_id)}</b>. {c.reason}.</> : c.reason}</p>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Candidate temporary medical sites</caption>
            <thead><tr><th scope="col">Candidate site (hypothetical)</th><th scope="col">Covered demand</th><th scope="col">Mean access time</th><th scope="col">Unreachable</th></tr></thead>
            <tbody>
              {c.table.map((r) => (
                <tr key={r.site_id} className={r.site_id === c.site_id ? 'row-hl' : ''}>
                  <td>{clinicName(r.site_id)}{r.site_id === c.site_id ? ' (recommended)' : ''}</td>
                  <td className="num">{r.covered_weight} / {c.total_demand_weight}</td>
                  <td className="num">{fmtMin(r.mean_time_s)}</td>
                  <td className="num">{r.unreachable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">{c.rule}</p>
        {c.site_id && (recDeployed
          ? <p className="ok-text"><Check size={14} aria-hidden /> Deployed as TMP-{c.site_id}. The optimiser can assign medical cases to it.</p>
          : <button type="button" className="btn btn-primary" disabled={off} title={offTitle}
              onClick={() => act(`Temporary post deployed at ${c.site_id}`, () => api.deployClinic(c.site_id!, 4))}>
              <Check size={16} aria-hidden /> Approve temporary post at {c.site_id} (4 simulated beds, medical only)
            </button>)}
        {deployed.length > 0 && <p className="small">Deployed posts: {deployed.map((h) => `${h.id} (${h.beds_available}/${h.beds_total} beds free)`).join(', ')}</p>}
      </section>

      <section className="card res-wide" aria-labelledby="fleet-h">
        <div className="card-head"><h2 id="fleet-h">Ambulance fleet (simulated)</h2></div>
        <AmbulanceFleet s={s} />
      </section>
      <section className="card res-wide" aria-labelledby="hosp-h">
        <div className="card-head"><h2 id="hosp-h">Hospital status</h2><Link to="/simulation" className="small">Change capacity in Disaster Simulation</Link></div>
        <HospitalCapacity s={s} editable={false} />
      </section>
    </div>
  )
}
