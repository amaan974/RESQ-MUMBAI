import { useSim } from '../store'

function labelClass(label: string) {
  if (label === 'REAL MAP GEOMETRY' || label.startsWith('OSM')) return 'src-real'
  if (label.startsWith('UNKNOWN')) return 'src-unknown'
  if (label.startsWith('THIRD-PARTY')) return 'src-context'
  return 'src-sim'
}

export default function DataSources() {
  const { s } = useSim()
  if (!s) return null
  const meta = s.graph.meta as Record<string, unknown>
  const bbox = Array.isArray(meta.bbox_wsen) ? (meta.bbox_wsen as number[]).join(', ') : 'n/a'
  const extra = [
    { layer: 'Temporary medical posts', label: 'SCENARIO / SIMULATED', source: 'Created only when the dispatcher approves a hypothetical candidate site' },
    { layer: 'Shelters, evacuation origins, staging sites', label: 'SCENARIO / SIMULATED', source: 'Scenario file; hypothetical sites' },
  ]
  return (
    <div className="stack">
      <section className="card" aria-labelledby="prov-h">
        <div className="card-head"><h2 id="prov-h">Data provenance</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Layer</th><th scope="col">Label</th><th scope="col">Source</th><th scope="col">Retrieved / observed</th></tr></thead>
            <tbody>
              {s.sources.map((x) => (
                <tr key={x.layer}>
                  <th scope="row">{x.layer}</th>
                  <td><span className={`src ${labelClass(x.label)}`}>{x.label}</span></td>
                  <td className="small">{x.source}{x.license ? `. ${x.license}` : ''}</td>
                  <td className="small num">{x.observed_at ?? 'n/a'}</td>
                </tr>
              ))}
              {extra.map((x) => (
                <tr key={x.layer}>
                  <th scope="row">{x.layer}</th>
                  <td><span className={`src ${labelClass(x.label)}`}>{x.label}</span></td>
                  <td className="small">{x.source}</td>
                  <td className="small">n/a</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col">
        <section className="card" aria-labelledby="graph-h">
          <div className="card-head"><h2 id="graph-h">Road graph</h2></div>
          <dl className="kv">
            <dt>Type</dt><dd>{s.graph.label}</dd>
            <dt>Source</dt><dd>{String(meta.source ?? 'n/a')}</dd>
            <dt>Retrieved</dt><dd className="num">{String(meta.retrieved_at ?? 'n/a')}</dd>
            <dt>Size</dt><dd className="num">{s.graph.nodes} nodes, {s.graph.edges} directed edges</dd>
            <dt>Bounding box (W, S, E, N)</dt><dd className="num">{bbox}</dd>
            <dt>Licence</dt><dd>{String(meta.license ?? 'n/a')}</dd>
            <dt>Note</dt><dd>{String(meta.note ?? '')}</dd>
          </dl>
          <p className="small">Travel time is edge length divided by an assumed free-flow speed per road class (trunk 40, primary 35,
            secondary 30, tertiary 25, unclassified 20 km/h; links slower). It is not live traffic.</p>
        </section>

        <section className="card" aria-labelledby="ctx-h">
          <div className="card-head"><h2 id="ctx-h">Hazard context</h2></div>
          {s.weather?.status === 'ok' ? (
            <dl className="kv">
              <dt>Rainfall</dt><dd>{s.weather.current_precip_mm} mm now, {s.weather.next_6h_precip_mm} mm forecast for the next 6 h</dd>
              <dt>Source</dt><dd>{s.weather.source}</dd>
              <dt>Valid for</dt><dd>{s.weather.observed_at}</dd>
              <dt>Use</dt><dd>{s.weather.note}</dd>
            </dl>
          ) : <p>Rainfall: not connected ({s.weather?.reason ?? 'no data'}).</p>}
          <p>Tide: not connected. Flood zones are hypothetical, rule-based circles. They never close roads; only a dispatcher-confirmed closure does.</p>
        </section>
      </div>

      <section className="card" aria-labelledby="safe-h">
        <div className="card-head"><h2 id="safe-h">Safety boundaries</h2></div>
        <ul className="plain-list">
          <li>Research simulation. It never contacts real emergency services or routes real people.</li>
          <li>The citizen SOS page collects no name, phone number, diagnosis or GPS position.</li>
          <li>Every dispatch, reroute, repositioning and temporary post requires explicit dispatcher approval. Priority is set by the dispatcher; there is no automated medical triage.</li>
          <li>The optimiser is an exact combinatorial search, not a trained or predictive AI model.</li>
          <li>Hospital beds and eligibility are simulated, not real facility status. No result here is a claim about real response times or outcomes.</li>
          <li>State is held in memory on a single backend process. A restart returns the scenario to its initial state.</li>
        </ul>
        <p className="small muted">Map data and hospital locations © OpenStreetMap contributors, ODbL 1.0. Rainfall context © Open-Meteo, CC BY 4.0.</p>
      </section>
    </div>
  )
}
