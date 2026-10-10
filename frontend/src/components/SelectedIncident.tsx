import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Ambulance, Check, ChevronLeft, ChevronRight, CircleHelp, History, Hospital, Map as MapIcon, TriangleAlert, User } from 'lucide-react'
import { api, type Decision, type Incident, type State } from '../api'
import { useSim } from '../store'
import { PHASE_LABEL, PRIORITY_LABEL, TYPE_LABEL, elapsedLabel, fmtKm, fmtMin, supersededFor } from '../lib/derive'
import { PriorityBadge, StatusBadge } from './IncidentQueue'
import { TYPE_ICON } from '../lib/map'

type Tab = 'rec' | 'details' | 'history'
type Leg = 'to_incident' | 'to_hospital'

const PHASES: Decision['phase'][] = ['to_incident', 'to_hospital', 'at_hospital']

function PriorityControl({ inc }: { inc: Incident }) {
  const { act, online, busy } = useSim()
  const locked = inc.status === 'approved'
  const disabled = !online || busy || locked
  return (
    <div className="prio-control">
      <label>
        <span>Priority</span>
        <select value={inc.priority} disabled={disabled}
          title={locked ? 'Priority is locked after approval' : 'Dispatcher-set priority (no automated triage)'}
          onChange={(e) => act(`${inc.id} priority set to ${PRIORITY_LABEL[Number(e.target.value)]}`, () => api.setPriority(inc.id, Number(e.target.value)))}>
          <option value={3}>High</option><option value={2}>Medium</option><option value={1}>Low</option>
        </select>
      </label>
      {!inc.priority_confirmed && !locked && (
        <button type="button" className="btn btn-sm" disabled={disabled}
          onClick={() => act(`${inc.id} priority ${PRIORITY_LABEL[inc.priority]} confirmed`, () => api.setPriority(inc.id, inc.priority))}>
          <Check size={14} aria-hidden /> Confirm {PRIORITY_LABEL[inc.priority]}
        </button>
      )}
    </div>
  )
}

function Chain({ s, inc, d, onLeg }: { s: State; inc: Incident; d: Decision; onLeg: (l: Leg) => void }) {
  const amb = s.ambulances.find((a) => a.id === d.ambulance_id)
  const hos = s.hospitals.find((h) => h.id === d.hospital_id)
  const total = d.estimated_ambulance_time_s + d.estimated_transport_time_s
  const dist = d.route_to_incident.length_m + d.route_to_hospital.length_m
  return (
    <>
      <ol className="chain" aria-label="Dispatch chain">
        <li>
          <span className="chain-icon tone-info" aria-hidden><Ambulance size={18} /></span>
          <div className="chain-body">
            <span><b>{d.ambulance_id}</b> <span className="muted">from {amb?.label ?? 'unknown'} base (simulated)</span></span>
            <span>To patient <b className="num">{fmtMin(d.estimated_ambulance_time_s)}</b> <span className="muted num">({fmtKm(d.route_to_incident.length_m)})</span></span>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => onLeg('to_incident')} disabled={!d.route_to_incident.edge_ids.length}
            aria-label={`View route from ${d.ambulance_id} to ${inc.id} on the map`}>
            <MapIcon size={14} aria-hidden /> Route
          </button>
        </li>
        <li>
          <span className="chain-icon tone-critical" aria-hidden><User size={18} /></span>
          <div className="chain-body">
            <span><b>Patient</b> <span className="muted">at {inc.label}</span></span>
            <span className="muted">{TYPE_LABEL[inc.type] ?? inc.type}</span>
          </div>
        </li>
        <li>
          <span className="chain-icon tone-success" aria-hidden><Hospital size={18} /></span>
          <div className="chain-body">
            <span><b>{hos?.name ?? d.hospital_id}</b></span>
            <span>To hospital <b className="num">{fmtMin(d.estimated_transport_time_s)}</b> <span className="muted num">({fmtKm(d.route_to_hospital.length_m)})</span></span>
            {hos && (
              <span className="ok-text"><Check size={14} aria-hidden /> Accepts {(TYPE_LABEL[inc.type] ?? inc.type).toLowerCase()}, {hos.beds_available} simulated beds free</span>
            )}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => onLeg('to_hospital')} disabled={!d.route_to_hospital.edge_ids.length}
            aria-label={`View route from ${d.incident_id} to ${d.hospital_id} on the map`}>
            <MapIcon size={14} aria-hidden /> Route
          </button>
        </li>
      </ol>
      <p className="chain-total" title="Free-flow estimate from road length and assumed speeds, not live traffic">
        Total travel <b className="num">{fmtMin(total)}</b> <span className="num">({fmtKm(dist)})</span>
        <span className="muted">, free-flow network estimate</span>
      </p>
    </>
  )
}

function Progress({ d }: { d: Decision }) {
  const idx = PHASES.indexOf(d.phase)
  return (
    <ol className="progress" aria-label="Simulated unit progress">
      {PHASES.map((p, i) => (
        <li key={p} className={i < idx ? 'done' : i === idx ? 'current' : ''} aria-current={i === idx ? 'step' : undefined}>
          {PHASE_LABEL[p!]}
        </li>
      ))}
    </ol>
  )
}

function RecommendationTab({ s, inc, d, onLeg, onWhy, onHistory, nInvalid }: {
  s: State; inc: Incident; d: Decision | null; onLeg: (l: Leg) => void; onWhy: () => void; onHistory: () => void; nInvalid: number
}) {
  const { act, online, busy } = useSim()
  const off = !online || busy
  const offTitle = online ? undefined : 'Unavailable while the backend is unreachable'

  if (!d) {
    const infeasible = inc.status === 'infeasible'
    return (
      <div className={`notice ${infeasible ? 'notice-critical' : ''}`} role="status">
        <TriangleAlert size={18} aria-hidden />
        <div>
          <b>{infeasible ? 'No feasible recommendation' : 'Awaiting a recommendation'}</b>
          <p>{inc.reason ?? 'The backend has not produced a plan for this incident yet.'}</p>
          {infeasible && <p>Reopening roads or adding simulated capacity in <Link to="/simulation">Disaster Simulation</Link> triggers a new plan.</p>}
        </div>
      </div>
    )
  }

  const approved = d.status === 'approved'
  return (
    <div className="rec">
      <h3 className="section-label">{approved ? 'Approved dispatch (simulated)' : 'Recommended dispatch'}</h3>
      <Chain s={s} inc={inc} d={d} onLeg={onLeg} />

      {approved && (
        <div className={`unit-status ${d.blocked ? 'is-blocked' : ''}`}>
          <Progress d={d} />
          <p className="muted">Elapsed on route <span className="num">{fmtMin(d.elapsed_s ?? 0)}</span>. Units move only when the simulation clock is advanced.</p>
          {d.blocked && <p className="bad-text"><b>Unit holding before a closed road.</b> It waits at the last point where a detour exists.</p>}
        </div>
      )}

      {approved && d.review_required && (
        <div className="notice notice-warning" role="alert">
          <TriangleAlert size={18} aria-hidden />
          <div>
            <b>Operator review required</b>
            <p>{d.alerts.join('; ')}. Approved dispatches are never changed automatically.</p>
            {!d.suggested_reroute && <p><b>No open alternative route was found.</b></p>}
          </div>
        </div>
      )}

      {/* Primary decision control stays in view (sticky) while this panel is on screen. */}
      <div className="rec-primary">
        {!approved && (
          <button type="button" className="btn btn-primary btn-block" disabled={off} title={offTitle}
            onClick={() => act(`${d.id} approved: ${d.ambulance_id} dispatched in simulation`, () => api.approve(d.id))}>
            <Check size={18} aria-hidden /> Approve and dispatch (simulation)
          </button>
        )}
        {approved && d.review_required && d.suggested_reroute && (
          <button type="button" className="btn btn-primary btn-block" disabled={off} title={offTitle}
            onClick={() => act(`Reroute accepted for ${d.id}`, () => api.acceptReroute(d.id))}>
            <Check size={18} aria-hidden /> Accept suggested reroute
            ({fmtMin(d.suggested_reroute.route_to_incident.travel_time_s + d.suggested_reroute.route_to_hospital.travel_time_s)})
          </button>
        )}
        {approved && (
          <button type="button" className={`btn btn-block ${d.phase === 'at_hospital' && !d.review_required ? 'btn-primary' : ''}`} disabled={off} title={offTitle}
            onClick={() => act(`${d.id} handover confirmed; ${d.ambulance_id} available again`, () => api.complete(d.id))}>
            <Hospital size={18} aria-hidden /> {d.phase === 'at_hospital' ? 'Confirm hospital handover' : 'Mark handover complete'}
          </button>
        )}
      </div>
      <div className="rec-secondary">
          <button type="button" className="btn" onClick={onHistory} disabled={nInvalid === 0}
            title={nInvalid ? undefined : 'No earlier option for this incident has been invalidated'}>
            <History size={16} aria-hidden /> Invalidated options ({nInvalid})
          </button>
          <button type="button" className="btn" onClick={onWhy}><CircleHelp size={16} aria-hidden /> Why this recommendation?</button>
      </div>
    </div>
  )
}

function DetailsTab({ s, inc, d }: { s: State; inc: Incident; d: Decision | null }) {
  const amb = d ? s.ambulances.find((a) => a.id === d.ambulance_id) : undefined
  const hos = d ? s.hospitals.find((h) => h.id === d.hospital_id) : undefined
  return (
    <div className="details">
      <dl className="kv">
        <dt>Incident</dt><dd>{inc.id}</dd>
        <dt>Type</dt><dd>{TYPE_LABEL[inc.type] ?? inc.type}</dd>
        <dt>Priority</dt><dd>{PRIORITY_LABEL[inc.priority]} ({inc.priority_confirmed ? 'confirmed by dispatcher' : 'default, not yet confirmed'})</dd>
        <dt>Status</dt><dd>{inc.status}</dd>
        <dt>Source</dt><dd>{inc.source === 'citizen_sos' ? 'Citizen SOS page (simulated)' : 'Scenario / dispatcher simulation'}</dd>
        <dt>Location</dt><dd>{inc.label}</dd>
        <dt>Coordinates</dt><dd className="num">{inc.lat.toFixed(4)}, {inc.lon.toFixed(4)} (snapped to graph node {inc.node})</dd>
        <dt>Reported</dt><dd>{new Date(inc.created_at).toLocaleString()}</dd>
        {d && <>
          <dt>Decision</dt><dd>{d.id}, plan v{d.plan_version}, trigger: {d.trigger}</dd>
          <dt>Ambulance</dt><dd>{d.ambulance_id}, base {amb?.label}, {amb?.status.replace(/_/g, ' ')}</dd>
          <dt>Hospital</dt><dd>{hos?.name} ({d.hospital_id}): {hos?.beds_available} of {hos?.beds_total} simulated beds free; accepts {hos?.eligible_types.join(', ').replace(/_/g, ' ')}</dd>
        </>}
      </dl>
      {d && (
        <>
          <h3 className="section-label">Road segments on the route</h3>
          <ul className="segments">
            {d.route_to_incident.segments.map((g, i) => <li key={`a${i}`}><span className="seg-leg">To patient</span> {g.name} <span className="muted num">{Math.round(g.length_m)} m</span></li>)}
            {d.route_to_hospital.segments.map((g, i) => <li key={`b${i}`}><span className="seg-leg">To hospital</span> {g.name} <span className="muted num">{Math.round(g.length_m)} m</span></li>)}
          </ul>
          <p className="muted small">Closing a specific segment is available in <Link to="/simulation">Disaster Simulation</Link>.</p>
        </>
      )}
    </div>
  )
}

function HistoryTab({ s, inc }: { s: State; inc: Incident }) {
  const old = supersededFor(s, inc.id)
  const events = s.events.filter((e) => e.message.includes(inc.id))
  return (
    <div className="history">
      <h3 className="section-label">Invalidated options</h3>
      {old.length === 0 ? <p className="muted">None. The current recommendation is the first one for this incident.</p> : (
        <ul className="hist-list">
          {old.map((d) => (
            <li key={d.id}>
              <b>{d.id}</b>: {d.ambulance_id} to {d.hospital_id}, {fmtMin(d.estimated_ambulance_time_s + d.estimated_transport_time_s)}
              <div className="muted">Invalidated: {d.invalidation}{d.superseded_by ? `. Replaced by ${d.superseded_by}` : ''}</div>
            </li>
          ))}
        </ul>
      )}
      <h3 className="section-label">Event history</h3>
      {events.length === 0 ? <p className="muted">No events recorded for this incident.</p> : (
        <ul className="hist-list">
          {events.map((e, i) => <li key={i}><span className="muted num">{new Date(e.t).toLocaleTimeString()}</span> {e.message}</li>)}
        </ul>
      )}
    </div>
  )
}

export default function SelectedIncident({ s, inc, d, position, total, onPrev, onNext, onLeg, onWhy }: {
  s: State
  inc: Incident | null
  d: Decision | null
  position: number
  total: number
  onPrev: () => void
  onNext: () => void
  onLeg: (l: Leg) => void
  onWhy: () => void
}) {
  const [tab, setTab] = useState<Tab>('rec')
  if (!inc) {
    return (
      <section className="card selected" aria-labelledby="sel-h">
        <div className="card-head"><h2 id="sel-h">Selected incident</h2></div>
        <div className="empty">No active incident to review.</div>
      </section>
    )
  }
  const Icon = TYPE_ICON[inc.type] ?? TYPE_ICON.medical
  const nInvalid = supersededFor(s, inc.id).length
  const tabs: [Tab, string][] = [['rec', 'Recommendation'], ['details', 'Details'], ['history', `History (${nInvalid})`]]

  return (
    <section className="card selected" aria-labelledby="sel-h">
      <div className="card-head">
        <h2 id="sel-h">Selected incident</h2>
        <div className="pager">
          <button type="button" className="icon-btn" onClick={onPrev} disabled={total < 2} aria-label="Previous incident"><ChevronLeft size={18} /></button>
          <span className="num">{position} / {total}</span>
          <button type="button" className="icon-btn" onClick={onNext} disabled={total < 2} aria-label="Next incident"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="ident">
        <span className={`ident-icon prio-${inc.priority}`} aria-hidden><Icon size={26} /></span>
        <div className="ident-main">
          <div className="ident-line"><span className="ident-id">{inc.id}</span> <PriorityBadge p={inc.priority} confirmed={inc.priority_confirmed} /></div>
          <div className="ident-type">{TYPE_LABEL[inc.type] ?? inc.type} <StatusBadge status={inc.status} /></div>
          <div className="muted small">{inc.label}. <span className="num">{inc.lat.toFixed(4)}° N, {inc.lon.toFixed(4)}° E</span></div>
        </div>
        <div className="ident-side">
          <span className="muted small">{elapsedLabel(inc.created_at, s.server_time)}</span>
          <PriorityControl inc={inc} />
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Incident views">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`}
            className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tabpanel">
        {tab === 'rec' && <RecommendationTab s={s} inc={inc} d={d} onLeg={onLeg} onWhy={onWhy} onHistory={() => setTab('history')} nInvalid={nInvalid} />}
        {tab === 'details' && <DetailsTab s={s} inc={inc} d={d} />}
        {tab === 'history' && <HistoryTab s={s} inc={inc} />}
      </div>
    </section>
  )
}
