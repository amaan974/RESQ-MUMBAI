import { Ambulance, CircleCheck, Hospital, Info, TriangleAlert } from 'lucide-react'
import type { Decision, LatLng } from '../api'
import { fmtKm, fmtMin, routeState } from '../lib/derive'

/** Schematic of the backend's graph-derived route polylines (equirectangular projection, no map tiles). */
function Schematic({ d }: { d: Decision }) {
  const a = d.route_to_incident.polyline
  const b = d.route_to_hospital.polyline
  const all: LatLng[] = [...a, ...b]
  if (all.length < 2) return <div className="schematic empty-schematic">Ambulance is already at the incident location.</div>
  const lats = all.map((p) => p[0]); const lons = all.map((p) => p[1])
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2
  const k = Math.cos((lat0 * Math.PI) / 180)
  const minX = Math.min(...lons) * k, maxX = Math.max(...lons) * k
  const minY = -Math.max(...lats), maxY = -Math.min(...lats)
  const W = 320, H = 150, pad = 18
  const scale = Math.min((W - 2 * pad) / Math.max(maxX - minX, 1e-6), (H - 2 * pad) / Math.max(maxY - minY, 1e-6))
  const ox = (W - (maxX - minX) * scale) / 2, oy = (H - (maxY - minY) * scale) / 2
  const xy = (p: LatLng) => [ox + (p[1] * k - minX) * scale, oy + (-p[0] - minY) * scale] as const
  const path = (pts: LatLng[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${xy(p)[0].toFixed(1)},${xy(p)[1].toFixed(1)}`).join(' ')
  const start = xy(a[0] ?? b[0]); const mid = xy(b[0] ?? a[a.length - 1]); const end = xy(b[b.length - 1] ?? a[a.length - 1])
  return (
    <svg className="schematic" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Route schematic: ${d.ambulance_id} to ${d.incident_id}, then ${d.incident_id} to ${d.hospital_id}`}>
      {a.length > 1 && <path d={path(a)} fill="none" stroke="#1F5BB5" strokeWidth="3.5" strokeLinejoin="round" />}
      {b.length > 1 && <path d={path(b)} fill="none" stroke="#23734D" strokeWidth="3.5" strokeDasharray="7 5" strokeLinejoin="round" />}
      <circle cx={start[0]} cy={start[1]} r="5" fill="#1F5BB5" />
      <circle cx={mid[0]} cy={mid[1]} r="6" fill="#B93A42" stroke="#fff" strokeWidth="2" />
      <circle cx={end[0]} cy={end[1]} r="5" fill="#23734D" />
      <text x={start[0] + 8} y={start[1] - 6} className="sch-label">{d.ambulance_id}</text>
      <text x={mid[0] + 8} y={mid[1] - 6} className="sch-label">{d.incident_id}</text>
      <text x={end[0] + 8} y={end[1] + 14} className="sch-label">{d.hospital_id}</text>
    </svg>
  )
}

export default function RoutePreview({ d }: { d: Decision | null }) {
  if (!d) {
    return (
      <section className="card preview" aria-labelledby="prev-h">
        <div className="card-head"><h2 id="prev-h">Route preview</h2></div>
        <div className="empty">Select an incident with a recommendation to preview its route.</div>
      </section>
    )
  }
  const t1 = d.estimated_ambulance_time_s, t2 = d.estimated_transport_time_s
  const st = routeState(d)
  return (
    <section className="card preview" aria-labelledby="prev-h">
      <div className="card-head">
        <h2 id="prev-h">Route preview</h2>
        <span className="muted small">Total <b className="num">{fmtMin(t1 + t2)}</b> <span className="num">({fmtKm(d.route_to_incident.length_m + d.route_to_hospital.length_m)})</span></span>
      </div>
      <div className="legs">
        <div className="leg leg-blue">
          <span className="leg-title"><Ambulance size={14} aria-hidden /> {d.ambulance_id} to patient</span>
          <b className="num">{fmtMin(t1)}</b><span className="muted num">{fmtKm(d.route_to_incident.length_m)}</span>
        </div>
        <div className="leg leg-green">
          <span className="leg-title"><Hospital size={14} aria-hidden /> Patient to {d.hospital_id}</span>
          <b className="num">{fmtMin(t2)}</b><span className="muted num">{fmtKm(d.route_to_hospital.length_m)}</span>
        </div>
      </div>
      <Schematic d={d} />
      <p className={`route-state rs-${st.kind}`}>
        {st.kind === 'open' ? <CircleCheck size={14} aria-hidden /> : <TriangleAlert size={14} aria-hidden />} {st.text}
      </p>
      <p className="muted small"><Info size={12} aria-hidden /> Network estimates at assumed free-flow speeds. On-scene time is not modelled.</p>
    </section>
  )
}
