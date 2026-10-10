import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api, type Metrics, type PlanMetrics, type Suite, type SuiteSummary } from '../api'
import { useSim } from '../store'
import { fmtMin } from '../lib/derive'

const ROWS: [string, (m: PlanMetrics) => string | number][] = [
  ['Incidents served', (m) => `${m.incidents_served} / ${m.incidents_total}`],
  ['Served High / Medium / Low', (m) => `${m.served_by_priority.high} / ${m.served_by_priority.medium} / ${m.served_by_priority.low}`],
  ['Mean response (to patient)', (m) => fmtMin(m.mean_response_s)],
  ['Mean High-priority response', (m) => fmtMin(m.mean_high_priority_response_s)],
  ['Maximum response', (m) => fmtMin(m.max_response_s)],
  ['Total response + transport', (m) => fmtMin(m.total_chain_s)],
  ['Priority-weighted chain cost (s)', (m) => m.weighted_chain_cost],
]

function Compare({ title, o, b, bp, note }: { title: string; o: PlanMetrics; b: PlanMetrics; bp: PlanMetrics; note?: string }) {
  return (
    <div className="compare">
      <h3 className="section-label">{title}</h3>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th scope="col">Measured in simulation</th><th scope="col">RESQ optimiser</th><th scope="col">FIFO nearest-feasible</th><th scope="col">Priority-first nearest-feasible</th></tr></thead>
          <tbody>
            {ROWS.map(([k, f]) => <tr key={k}><th scope="row">{k}</th><td className="num"><b>{f(o)}</b></td><td className="num">{f(b)}</td><td className="num">{f(bp)}</td></tr>)}
            {o.compute_ms !== undefined && <tr><th scope="row">Solver runtime</th><td className="num">{o.compute_ms} ms</td><td className="muted">n/a</td><td className="muted">n/a</td></tr>}
          </tbody>
        </table>
      </div>
      {note && <p className="muted small">{note}</p>}
    </div>
  )
}

function SuiteRow({ label, x }: { label: string; x: SuiteSummary }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="num">{x.optimizer_better} / {x.tie} / {x.optimizer_worse}</td>
      <td className="num">{x.served_high_optimizer} / {x.served_high_baseline}</td>
      <td className="num">{x.served_total_optimizer} / {x.served_total_baseline}</td>
      <td className="num">{fmtMin(x.mean_high_priority_response_s_optimizer)} / {fmtMin(x.mean_high_priority_response_s_baseline)}</td>
      <td className="num">{x.mean_weighted_cost_optimizer} / {x.mean_weighted_cost_baseline}</td>
    </tr>
  )
}

export default function AnalyticsReports() {
  const { s } = useSim()
  const [m, setM] = useState<Metrics | null>(null)
  const [mErr, setMErr] = useState<string | null>(null)
  const [suite, setSuite] = useState<Suite | null>(null)
  const [suiteErr, setSuiteErr] = useState<string | null>(null)
  const [loadingSuite, setLoadingSuite] = useState(true)
  const version = s?.plan.version

  useEffect(() => {
    if (version === undefined) return
    let live = true
    api.metrics().then((x) => { if (live) { setM(x); setMErr(null) } }).catch((e) => { if (live) setMErr((e as Error).message) })
    return () => { live = false }
  }, [version])

  const fetchSuite = () => api.suite()
    .then((x) => { setSuite(x); setSuiteErr(null) })
    .catch((e) => setSuiteErr((e as Error).message))
    .finally(() => setLoadingSuite(false))
  const reloadSuite = () => { setLoadingSuite(true); void fetchSuite() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchSuite() }, [])

  if (!s) return null
  return (
    <div className="stack">
      <section className="card" aria-labelledby="cmp-h">
        <div className="card-head"><h2 id="cmp-h">Optimiser vs nearest-feasible baselines</h2><span className="muted small">Same incidents, units, beds, eligibility and closures for all three</span></div>
        {mErr && <p className="bad-text">Could not load metrics: {mErr}</p>}
        {!m && !mErr && <p className="muted">Loading measured comparison.</p>}
        {m && (
          <>
            <Compare title={`Current unapproved incidents (${m.current.optimizer.incidents_total})`} o={m.current.optimizer} b={m.current.baseline} bp={m.current.baseline_priority} note={m.current.note} />
            <Compare title={`Stress scenario: ${m.benchmark.description}`} o={m.benchmark.optimizer} b={m.benchmark.baseline} bp={m.benchmark.baseline_priority} />
            <dl className="kv defs">
              <dt>RESQ optimiser</dt><dd>{m.definitions.optimizer}</dd>
              <dt>FIFO nearest-feasible</dt><dd>{m.definitions.baseline}</dd>
              <dt>Priority-first</dt><dd>{m.definitions.baseline_priority}</dd>
              <dt>Travel times</dt><dd>{m.definitions.times}</dd>
            </dl>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="suite-h">
        <div className="card-head">
          <h2 id="suite-h">Seeded benchmark suite</h2>
          <button type="button" className="btn btn-sm" onClick={reloadSuite} disabled={loadingSuite}><RefreshCw size={14} aria-hidden /> {loadingSuite ? 'Loading' : 'Reload'}</button>
        </div>
        {suiteErr && <p className="bad-text">Could not load the benchmark: {suiteErr}</p>}
        {!suite && !suiteErr && <p className="muted">Running the seeded suite on the backend.</p>}
        {suite && (
          <>
            <p className="small">{suite.description}. Computed in {suite.compute_s} s.</p>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Optimiser compared with</th><th scope="col">Better / tie / worse</th><th scope="col">High served (opt / base)</th><th scope="col">All served</th><th scope="col">Mean High response</th><th scope="col">Mean weighted cost</th></tr></thead>
                <tbody>
                  <SuiteRow label="FIFO nearest-feasible, all runs" x={suite.overall} />
                  {Object.entries(suite.by_condition).map(([k, x]) => <SuiteRow key={`f${k}`} label={`FIFO, ${k}`} x={x} />)}
                  <SuiteRow label="Priority-first, all runs" x={suite.overall_vs_priority_greedy} />
                  {Object.entries(suite.by_condition_vs_priority_greedy).map(([k, x]) => <SuiteRow key={`p${k}`} label={`Priority-first, ${k}`} x={x} />)}
                </tbody>
              </table>
            </div>
            <p className="muted small">{suite.comparison_rule} The optimiser is not better on every metric in every run; read each column on its own. Simulation measurements only, not real-world outcomes.</p>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="log-h">
        <div className="card-head"><h2 id="log-h">Event log</h2><span className="muted small">Latest {s.events.length} backend events</span></div>
        <ol className="event-log">
          {s.events.map((e, i) => (
            <li key={i} className={`ev ev-${e.kind}`}>
              <span className="muted num">{new Date(e.t).toLocaleTimeString()}</span>
              <span className="ev-kind">{e.kind}</span>
              <span>{e.message}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
