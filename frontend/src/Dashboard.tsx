import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtKm, fmtMin, TYPE_LABEL, type Decision, type Metrics, type PlanMetrics, type State, type Suite, type SuiteSummary } from './api'
import MapView, { type Layers } from './MapView'
import { Banner } from './Banner'

const PHASE: Record<string, string> = { to_incident: 'en route to patient', to_hospital: 'patient on board → hospital', at_hospital: 'at hospital — confirm handover' }

const STATUS_CLASS: Record<string, string> = {
  pending: 'st-pending', reviewed: 'st-pending', recommended: 'st-rec', infeasible: 'st-bad', approved: 'st-ok', resolved: 'st-muted',
}

export default function Dashboard() {
  const [s, setS] = useState<State | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [selInc, setSelInc] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [suite, setSuite] = useState<Suite | null>(null)
  const [suiteBusy, setSuiteBusy] = useState(false)
  const [evacOrigin, setEvacOrigin] = useState<string | null>('EVO-1')
  const [zone, setZone] = useState('FZ-1')
  const [layers, setLayers] = useState<Layers>({ tiles: true, network: false, flood: true, others: true, evac: true, sites: true })

  const refresh = useCallback(async () => {
    try {
      setS(await api.state())
      setErr(null)
    } catch (e) {
      setErr(`Backend unreachable: ${(e as Error).message}`)
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    api.weather().catch(() => undefined) // populates server cache; shown via /api/state
    const t = setInterval(() => api.weather().catch(() => undefined), 600000)
    return () => clearInterval(t)
  }, [])

  const planVersion = s?.plan.version
  useEffect(() => {
    if (planVersion === undefined) return
    api.metrics().then(setMetrics).catch(() => setMetrics(null))
  }, [planVersion])

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      setToast(`✓ ${label}`)
    } catch (e) {
      setToast(`✗ ${label}: ${(e as Error).message}`)
    } finally {
      setBusy(false)
      await refresh()
      setTimeout(() => setToast(null), 5000)
    }
  }

  const decisionsById = useMemo(() => Object.fromEntries((s?.decisions ?? []).map((d) => [d.id, d])), [s])
  const active = (s?.incidents ?? []).filter((i) => i.status !== 'resolved')
  const queue = [...active].sort((a, b) => b.priority - a.priority || b.seq - a.seq)
  const current = (s?.decisions ?? []).filter((d) => d.status === 'recommended' || d.status === 'approved')

  // selected incident -> its live decision
  const selIncident = active.find((i) => i.id === selInc) ?? queue.find((i) => i.decision_id) ?? queue[0] ?? null
  const selDecision: Decision | null = selIncident
    ? (selIncident.decision_id ? decisionsById[selIncident.decision_id] : null) ??
      current.find((d) => d.incident_id === selIncident.id) ?? null
    : null
  const superseded = selIncident ? (s?.decisions ?? []).filter((d) => d.incident_id === selIncident.id && d.status === 'superseded').slice(-3).reverse() : []

  if (!s) {
    return (
      <div className="app">
        <Banner />
        <div className="loading">{err ?? 'Loading simulation state…'}</div>
      </div>
    )
  }

  const hosp = Object.fromEntries(s.hospitals.map((h) => [h.id, h]))
  const unapproved = active.filter((i) => i.status !== 'approved').length
  const availAmb = s.ambulances.filter((a) => a.status === 'available').length
  const hospWithBeds = s.hospitals.filter((h) => h.beds_available > 0).length
  const road = s.sources.find((x) => x.layer === 'Road network')

  return (
    <div className="app">
      <Banner />
      <header className="top">
        <div className="brand">
          <div className="logo">R</div>
          <div>
            <div className="title">RESQ Mumbai</div>
            <div className="sub">Dispatcher decision support · flood scenario simulation</div>
          </div>
        </div>
        <div className="badges">
          <span className={`badge ${road?.label === 'REAL MAP GEOMETRY' ? 'b-real' : 'b-synth'}`} title={`${road?.source} · ${road?.license}`}>
            {road?.label} · OSM {road?.observed_at?.slice(0, 10)} · {s.graph.nodes} nodes / {s.graph.edges} directed edges
          </span>
          <span className="badge b-sim">SCENARIO / SIMULATED: units · beds · incidents · closures · flood zones</span>
          {s.weather?.status === 'ok' ? (
            <span className="badge b-unknown" title={`${s.weather.source} · ${s.weather.note}`}>
              Rain (Open-Meteo forecast, context only): now {s.weather.current_precip_mm} mm · next 6 h {s.weather.next_6h_precip_mm} mm · {s.weather.observed_at}
            </span>
          ) : (
            <span className="badge b-unknown" title={s.weather?.reason}>Rainfall: {s.weather?.label ?? 'UNKNOWN / NOT CONNECTED'}</span>
          )}
          <span className="badge b-unknown">Tide: NOT CONNECTED</span>
        </div>
        <div className="meta">
          <div>Plan v{s.plan.version} · {s.plan.proven_optimal === false ? <b className="warn-text">best found (optimality not proven)</b> : 'proven optimal'} · {s.plan.compute_ms} ms · {s.plan.nodes_explored} search nodes</div>
          <div className="muted">trigger: {s.plan.trigger} · {new Date(s.server_time).toLocaleTimeString()}</div>
          <Link to="/sos" target="_blank" className="link">Open citizen SOS page ↗</Link>
        </div>
      </header>

      <section className="controls">
        <button disabled={busy} className="primary" onClick={() => act('Re-optimised from server state', api.optimize)}>⟳ Optimize now</button>
        <button disabled={busy} onClick={() => act('Simulated emergency added', api.addIncident)}>+ Add emergency</button>
        <select value={zone} onChange={(e) => setZone(e.target.value)} title="Scenario flood zones (hypothetical)">
          {s.flood_zones.map((z) => <option key={z.id} value={z.id}>{z.id} {z.name}</option>)}
        </select>
        <button disabled={busy} className="danger-outline" onClick={() => act(`Closures confirmed in ${zone}`, () => api.floodZone(zone))}>Confirm flood-zone closure</button>
        <button disabled={busy || s.closed_edges.length === 0} onClick={() => act('All roads reopened', api.reopen)}>Reopen all roads</button>
        <button disabled={busy} className="danger-outline" onClick={() => act('Scenario reset', async () => { await api.reset(); setSelInc(null) })}>↺ Reset scenario</button>
        <span className="clock" title="Simulation clock: moves APPROVED units along approved routes">
          Sim clock T+{Math.floor(s.sim_time_s / 60)}:{String(Math.floor(s.sim_time_s % 60)).padStart(2, '0')}
        </span>
        <button disabled={busy} onClick={() => act('Clock +1 min', () => api.advance(60))}>▶ +1 min</button>
        <button disabled={busy} onClick={() => act('Clock +5 min', () => api.advance(300))}>⏩ +5 min</button>
        <span className="sep" />
        {(['tiles', 'network', 'flood', 'others', 'evac', 'sites'] as const).map((k) => (
          <label key={k} className="chk">
            <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
            {{ tiles: 'Map tiles (online)', network: 'Routable OSM graph (offline)', flood: 'Scenario flood zones', others: 'Other routes', evac: 'Evacuation route', sites: 'Shelters / clinic sites' }[k]}
          </label>
        ))}
        {toast && <span className={`toast ${toast.startsWith('✗') ? 'bad' : ''}`}>{toast}</span>}
        {err && <span className="toast bad">{err}</span>}
      </section>

      <section className="kpis">
        <Kpi tone="red" value={unapproved} label="Unapproved incidents" extra={`${active.length} active`} />
        <Kpi tone="blue" value={availAmb} label="Available ambulances" extra={`/ ${s.ambulances.length}`} />
        <Kpi tone="green" value={hospWithBeds} label="Hospitals with beds" extra={`${s.hospitals.reduce((n, h) => n + Math.max(0, h.beds_available), 0)} beds (sim)`} />
        <Kpi tone="amber" value={s.closed_edges.length} label="Closed directed edges" extra="confirmed (sim)" />
      </section>

      {s.alerts.length > 0 && current.some((d) => d.review_required) && (
        <section className="alertbar">
          ⚠ {current.filter((d) => d.review_required).map((d) => `${d.id}: ${d.alerts.join('; ')}`).join(' | ')} — approved dispatches are never changed automatically.
        </section>
      )}

      <main className="grid">
        <div className="mapcard card">
          <MapView s={s} selected={selDecision} layers={layers} evacOrigin={evacOrigin} onSelectIncident={setSelInc} />
          <div className="legend">
            <span><i className="ln blue" />Ambulance → incident</span>
            <span><i className="ln green dash" />Incident → hospital</span>
            <span><i className="ln red" />Closed road</span>
            <span><i className="ln orange dash" />Suggested reroute (needs approval)</span>
            <span><i className="ln teal dash" />Evacuation</span>
            <span><i className="ln purple" />Approved</span>
            <span className="muted">Road graph &amp; hospital locations © OpenStreetMap contributors (ODbL)</span>
          </div>
        </div>

        <aside className="card queue">
          <h3>Incident queue <small>({active.length})</small></h3>
          {queue.length === 0 && <div className="muted">No active incidents.</div>}
          {queue.map((i) => (
            <div key={i.id} className={`qitem ${selIncident?.id === i.id ? 'sel' : ''}`} onClick={() => setSelInc(i.id)}>
              <div className={`dot p${i.priority}`}>!</div>
              <div className="qbody">
                <div className="qhead"><b>{i.id}</b> <span className={`pill ${STATUS_CLASS[i.status]}`}>{i.status}</span></div>
                <div>{TYPE_LABEL[i.type] ?? i.type}</div>
                <div className="muted small">{i.label} · {i.source === 'citizen_sos' ? 'citizen SOS (sim)' : 'scenario'}</div>
                {i.reason && <div className="small bad-text">{i.reason}</div>}
              </div>
              <div className="qprio" onClick={(e) => e.stopPropagation()}>
                <select value={i.priority} disabled={busy || i.status === 'approved'}
                  onChange={(e) => act(`${i.id} priority set`, () => api.setPriority(i.id, Number(e.target.value)))}>
                  <option value={3}>HIGH</option><option value={2}>MEDIUM</option><option value={1}>LOW</option>
                </select>
                {!i.priority_confirmed && <div className="small warn-text">unconfirmed</div>}
              </div>
            </div>
          ))}
        </aside>

        <section className="card rec">
          <h3>Recommended action {selIncident && <small>for {selIncident.id}</small>}</h3>
          {!selIncident && <div className="muted">Select an incident.</div>}
          {selIncident && !selDecision && (
            <div className="infeasible">
              <b>No feasible recommendation.</b> {selIncident.reason ?? 'Awaiting optimisation.'}
            </div>
          )}
          {selDecision && (
            <DecisionCard d={selDecision} hospName={hosp[selDecision.hospital_id]?.name} busy={busy} act={act} />
          )}
          {superseded.length > 0 && (
            <div className="history">
              <div className="small muted">Invalidated / superseded options:</div>
              {superseded.map((d) => (
                <div key={d.id} className="small">
                  <s>{d.id}: {d.ambulance_id} → {d.hospital_id} ({fmtMin(d.estimated_ambulance_time_s + d.estimated_transport_time_s)})</s>
                  {' '}— {d.invalidation}{d.superseded_by ? ` → ${d.superseded_by}` : ''}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3>Ambulance fleet <small>(simulated)</small></h3>
          <table className="fleet">
            <thead><tr><th>ID</th><th>Status</th><th>Base</th><th>Assigned</th><th>ETA</th></tr></thead>
            <tbody>
              {s.ambulances.map((a) => {
                const d = current.find((x) => x.ambulance_id === a.id)
                return (
                  <tr key={a.id} className={d && d.id === selDecision?.id ? 'hl' : ''}>
                    <td>{a.id}</td>
                    <td><span className={`pill ${a.status === 'available' ? 'st-ok' : a.status === 'dispatched' ? 'st-rec' : 'st-bad'}`}>{a.status}</span></td>
                    <td>{a.label}</td>
                    <td>{d ? `${d.incident_id} (${d.status}${d.phase ? ` · ${PHASE[d.phase]}` : ''}${d.blocked ? ' · BLOCKED' : ''})` : '—'}</td>
                    <td>{d ? fmtMin(d.estimated_ambulance_time_s) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h3>Hospital capacity <small>(OSM-mapped locations · SIMULATED beds · temporary posts simulated)</small></h3>
          <table>
            <thead><tr><th>Hospital</th><th>Beds free</th><th>Accepts</th><th>Planned</th><th /></tr></thead>
            <tbody>
              {s.hospitals.map((h) => {
                const planned = current.filter((d) => d.hospital_id === h.id && d.status === 'recommended').length
                return (
                  <tr key={h.id} className={selDecision?.hospital_id === h.id ? 'hl' : ''}>
                    <td><b>{h.id}</b> <span className="small">{h.name}</span>{h.temporary && <span className="pill st-pending">temporary</span>}</td>
                    <td className={h.beds_available === 0 ? 'bad-text' : ''}>{h.beds_available} / {h.beds_total}</td>
                    <td className="small">{h.eligible_types.map((t) => t.replace('_', ' ')).join(', ')}</td>
                    <td>{planned}</td>
                    <td className="nowrap">
                      <button className="xs" disabled={busy || h.beds_available === 0} onClick={() => act(`${h.id} set FULL`, () => api.fillHospital(h.id))}>Set full</button>
                      <button className="xs" disabled={busy} onClick={() => act(`${h.id} +1 bed`, () => api.setCapacity(h.id, Math.max(0, h.beds_available) + 1))}>+1</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section className="card compare">
          <h3>Coordinated optimiser vs nearest-feasible baselines <small>(same constraints · measured, not claimed)</small></h3>
          {metrics ? (
            <>
              <CompareTable title={`Current unapproved incidents (${metrics.current.optimizer.incidents_total})`} o={metrics.current.optimizer} b={metrics.current.baseline} bp={metrics.current.baseline_priority} />
              <CompareTable title={`Stress scenario: ${metrics.benchmark.description}`} o={metrics.benchmark.optimizer} b={metrics.benchmark.baseline} bp={metrics.benchmark.baseline_priority} />
              <div className="small muted">FIFO: {metrics.definitions.baseline} Priority-first: {metrics.definitions.baseline_priority} Optimiser: {metrics.definitions.optimizer} {metrics.definitions.times}</div>
              <div className="suite">
                <button className="xs" disabled={suiteBusy} onClick={async () => { setSuiteBusy(true); try { setSuite(await api.suite()) } finally { setSuiteBusy(false) } }}>
                  {suiteBusy ? 'Running…' : suite ? 'Re-run seeded suite' : 'Run seeded benchmark suite (60 runs)'}
                </button>
                {suite && (
                  <>
                    <div className="small">{suite.description} · {suite.compute_s} s</div>
                    <table className="mini">
                      <thead><tr><th>vs baseline</th><th>Opt better / tie / worse</th><th>HIGH served opt / base</th><th>Mean HIGH resp opt / base</th><th>Mean weighted cost opt / base</th></tr></thead>
                      <tbody>
                        <SuiteRow label="FIFO greedy" x={suite.overall} />
                        <SuiteRow label="Priority-first greedy" x={suite.overall_vs_priority_greedy} />
                      </tbody>
                    </table>
                    <div className="small muted">{suite.comparison_rule}</div>
                  </>
                )}
              </div>
            </>
          ) : <div className="muted">Computing…</div>}
        </section>

        <section className="card hc05">
          <h3>Evacuation route <small>(minimal)</small></h3>
          <div className="row">
            <select value={evacOrigin ?? ''} onChange={(e) => setEvacOrigin(e.target.value)}>
              {s.evacuation_origins.map((o) => <option key={o.id} value={o.id}>{o.id} · {o.name} · {o.people} people</option>)}
            </select>
          </div>
          {evacOrigin && s.evacuation[evacOrigin] && (
            <div className={s.evacuation[evacOrigin].status === 'ok' ? '' : 'infeasible'}>
              <b>{s.evacuation[evacOrigin].status === 'ok' ? `→ ${s.evacuation[evacOrigin].shelter_id} ${s.shelters.find((x) => x.id === s.evacuation[evacOrigin].shelter_id)?.name}` : 'NO FEASIBLE SHELTER ROUTE'}</b>
              <div className="small">{s.evacuation[evacOrigin].reason}</div>
              {s.evacuation[evacOrigin].route && <div className="small muted">{fmtKm(s.evacuation[evacOrigin].route!.length_m)} · {s.evacuation[evacOrigin].route!.edge_ids.length} edges · recomputed on every closure</div>}
            </div>
          )}
          <h3>Temporary medical site <small>(heuristic)</small></h3>
          <div className={s.clinic.status === 'ok' ? '' : 'infeasible'}>
            <b>{s.clinic.site_id ? `${s.clinic.site_id} · ${s.clinic_sites.find((c) => c.id === s.clinic.site_id)?.name}` : 'No site covers demand'}</b>
            <div className="small">{s.clinic.reason}</div>
            <table className="mini">
              <thead><tr><th>Site</th><th>Covered wt</th><th>Mean time</th></tr></thead>
              <tbody>{s.clinic.table.map((r) => <tr key={r.site_id} className={r.site_id === s.clinic.site_id ? 'hl' : ''}><td>{r.site_id}</td><td>{r.covered_weight} / {s.clinic.total_demand_weight}</td><td>{fmtMin(r.mean_time_s)}</td></tr>)}</tbody>
            </table>
            <div className="small muted">{s.clinic.rule}</div>
            {s.clinic.site_id && (
              s.hospitals.some((h) => h.id === `TMP-${s.clinic.site_id}`)
                ? <div className="small"><b>Deployed</b> as TMP-{s.clinic.site_id} — now a simulated 'medical' stabilisation option for the optimiser.</div>
                : <button className="xs" disabled={busy} onClick={() => act(`Temporary post deployed at ${s.clinic.site_id}`, () => api.deployClinic(s.clinic.site_id!, 4))}>
                    Approve: deploy temporary post at {s.clinic.site_id} (4 simulated beds, medical only)
                  </button>
            )}
          </div>
          <h3>Vehicle positioning <small>(coverage heuristic)</small></h3>
          <div className="small">Demand covered within 5 min: <b>{s.positioning.covered_weight} / {s.positioning.total_weight}</b>{s.positioning.gaps.length > 0 && <> · gaps: {s.positioning.gaps.join(', ')}</>}</div>
          {s.positioning.recommendation ? (
            <div className="row">
              <span className="small">{s.positioning.recommendation.reason}</span>
              <button className="xs" disabled={busy} onClick={() => act('Repositioning approved', () => api.applyPositioning(s.positioning.recommendation!.ambulance_id, s.positioning.recommendation!.staging_site_id))}>Approve move</button>
            </div>
          ) : <div className="small muted">No single idle-unit move improves coverage.</div>}
          <div className="small muted">{s.positioning.rule}</div>
        </section>

        <section className="card log">
          <h3>Event log <small>(server)</small></h3>
          <div className="events">
            {s.events.map((e, i) => (
              <div key={i} className={`ev ev-${e.kind}`}><span className="muted">{new Date(e.t).toLocaleTimeString()}</span> <b>{e.kind}</b> {e.message}</div>
            ))}
          </div>
        </section>

        <section className="card sources">
          <h3>Data sources &amp; labels</h3>
          <table className="mini">
            <thead><tr><th>Layer</th><th>Label</th><th>Source</th></tr></thead>
            <tbody>{s.sources.map((x) => (
              <tr key={x.layer}><td>{x.layer}</td><td><span className={`badge ${x.label === 'REAL MAP GEOMETRY' ? 'b-real' : x.label.startsWith('OSM') ? 'b-real' : x.label.startsWith('UNKNOWN') ? 'b-unknown' : 'b-sim'}`}>{x.label}</span></td><td className="small">{x.source}{x.observed_at ? ` · retrieved ${x.observed_at.slice(0, 10)}` : ''}</td></tr>
            ))}</tbody>
          </table>
          <div className="small muted">Travel time = edge length ÷ assumed free-flow speed by road class (trunk 40, primary 35, secondary 30, tertiary 25 km/h…). Not live traffic. Map data © OpenStreetMap contributors, ODbL.</div>
        </section>
      </main>
    </div>
  )
}

function Kpi({ tone, value, label, extra }: { tone: string; value: number; label: string; extra: string }) {
  return (
    <div className={`kpi ${tone}`}>
      <div className="kv">{value}</div>
      <div><div>{label}</div><div className="small muted">{extra}</div></div>
    </div>
  )
}

function DecisionCard({ d, hospName, busy, act }: {
  d: Decision; hospName?: string; busy: boolean; act: (l: string, fn: () => Promise<unknown>) => Promise<void>
}) {
  return (
    <div className={`decision ${d.status}`}>
      <div className="dhead">
        <div>
          <div className="big">{d.status === 'approved' ? 'APPROVED: ' : 'Assign '}<b>{d.ambulance_id}</b> → {d.incident_id} → <b>{d.hospital_id}</b></div>
          <div className="small muted">{d.id} · plan v{d.plan_version} · trigger: {d.trigger} · {new Date(d.created_at).toLocaleTimeString()}</div>
        </div>
        <span className={`pill ${d.status === 'approved' ? 'st-ok' : 'st-rec'}`}>{d.status}</span>
      </div>
      <div className="legs">
        <div><span className="ln blue" /> To patient: <b>{fmtMin(d.estimated_ambulance_time_s)}</b> · {fmtKm(d.route_to_incident.length_m)} · {d.route_to_incident.edge_ids.length} edges</div>
        <div><span className="ln green dash" /> To {hospName ?? d.hospital_id}: <b>{fmtMin(d.estimated_transport_time_s)}</b> · {fmtKm(d.route_to_hospital.length_m)}</div>
      </div>
      {d.status === 'approved' && d.phase && (
        <div className={`phase ${d.blocked ? 'blocked' : ''}`}>
          Unit status (simulated movement): <b>{PHASE[d.phase]}</b> · elapsed {fmtMin(d.elapsed_s ?? 0)}
          {d.blocked && <b> · BLOCKED before a closed road — holding until the dispatcher accepts a reroute</b>}
        </div>
      )}
      <ul className="reasons">{d.reason.map((r, i) => <li key={i}>{r}</li>)}</ul>
      {d.review_required && (
        <div className="review">
          ⚠ Needs operator review: {d.alerts.join('; ')}
          {d.suggested_reroute ? (
            <button className="xs primary" disabled={busy} onClick={() => act(`Reroute accepted for ${d.id}`, () => api.acceptReroute(d.id))}>
              Accept suggested reroute ({fmtMin(d.suggested_reroute.route_to_incident.travel_time_s + d.suggested_reroute.route_to_hospital.travel_time_s)})
            </button>
          ) : <b> No open alternative route.</b>}
        </div>
      )}
      <div className="actions">
        {d.status === 'recommended' && (
          <button className="primary" disabled={busy} onClick={() => act(`${d.id} approved (simulated dispatch)`, () => api.approve(d.id))}>✓ Approve &amp; dispatch (sim)</button>
        )}
        {d.status === 'approved' && (
          <button disabled={busy} onClick={() => act(`${d.id} completed`, () => api.complete(d.id))}>Mark handover complete</button>
        )}
        <button className="danger-outline" disabled={busy || d.route_to_incident.edge_ids.length === 0}
          onClick={() => act('Road closed on route to patient', () => api.closeOnDecision(d.id, 'to_incident'))}>Close road on route to patient</button>
        <button className="danger-outline" disabled={busy || d.route_to_hospital.edge_ids.length === 0}
          onClick={() => act('Road closed on route to hospital', () => api.closeOnDecision(d.id, 'to_hospital'))}>Close road on route to hospital</button>
        <button className="danger-outline" disabled={busy}
          onClick={() => act(`${d.hospital_id} set FULL`, () => api.fillHospital(d.hospital_id))}>Set {d.hospital_id} full</button>
      </div>
      <details>
        <summary className="small">Road segments on route ({d.route_to_incident.segments.length + d.route_to_hospital.segments.length}) — close a specific one</summary>
        {[...d.route_to_incident.segments.map((x) => ({ ...x, leg: 'to patient' })), ...d.route_to_hospital.segments.map((x) => ({ ...x, leg: 'to hospital' }))].map((seg, i) => (
          <div key={i} className="segrow small">
            <span>{seg.leg}: {seg.name} · {Math.round(seg.length_m)} m · {seg.edge_ids.length} edge(s)</span>
            <button className="xs" disabled={busy} onClick={() => act(`Closed ${seg.name}`, () => api.closeEdges(seg.edge_ids))}>Close</button>
          </div>
        ))}
      </details>
    </div>
  )
}

function SuiteRow({ label, x }: { label: string; x: SuiteSummary }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{x.optimizer_better} / {x.tie} / {x.optimizer_worse}</td>
      <td>{x.served_high_optimizer} / {x.served_high_baseline}</td>
      <td>{fmtMin(x.mean_high_priority_response_s_optimizer)} / {fmtMin(x.mean_high_priority_response_s_baseline)}</td>
      <td>{x.mean_weighted_cost_optimizer} / {x.mean_weighted_cost_baseline}</td>
    </tr>
  )
}

function CompareTable({ title, o, b, bp }: { title: string; o: PlanMetrics; b: PlanMetrics; bp?: PlanMetrics }) {
  const rows: [string, (m: PlanMetrics) => string | number][] = [
    ['Incidents served', (m) => `${m.incidents_served} / ${m.incidents_total}`],
    ['Served HIGH / MED / LOW', (m) => `${m.served_by_priority.high} / ${m.served_by_priority.medium} / ${m.served_by_priority.low}`],
    ['Mean response (to patient)', (m) => fmtMin(m.mean_response_s)],
    ['Mean HIGH-priority response', (m) => fmtMin(m.mean_high_priority_response_s)],
    ['Max response', (m) => fmtMin(m.max_response_s)],
    ['Total chain time (resp + transport)', (m) => fmtMin(m.total_chain_s)],
    ['Priority-weighted chain cost (s)', (m) => m.weighted_chain_cost],
  ]
  return (
    <div className="cmp">
      <div className="small"><b>{title}</b></div>
      <table className="mini">
        <thead><tr><th>Measured in simulation</th><th>Optimiser</th><th>FIFO greedy</th><th>Priority-first greedy</th></tr></thead>
        <tbody>{rows.map(([k, f]) => <tr key={k}><td>{k}</td><td><b>{f(o)}</b></td><td>{f(b)}</td><td>{bp ? f(bp) : '—'}</td></tr>)}</tbody>
      </table>
    </div>
  )
}
