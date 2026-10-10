import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useSim } from '../store'
import { activeIncidents, decisionFor, pickSelected, sortQueue, type SortKey } from '../lib/derive'
import MapView, { LayerPanel } from '../MapView'
import { DEFAULT_LAYERS, type Focus, type Layers } from '../lib/map'
import OperationalSummary from '../components/OperationalSummary'
import IncidentQueue from '../components/IncidentQueue'
import SelectedIncident from '../components/SelectedIncident'
import RoutePreview from '../components/RoutePreview'
import DecisionExplanation from '../components/DecisionExplanation'

export default function DispatchCenter() {
  const { s, selectedId, select } = useSim()
  const [sortKey, setSortKey] = useState<SortKey>('priority')
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS)
  const [focus, setFocus] = useState<Focus | null>(null)
  if (!s) return null

  const queue = sortQueue(activeIncidents(s), sortKey)
  const inc = pickSelected(queue, selectedId)
  const d = decisionFor(s, inc)
  const idx = inc ? queue.findIndex((i) => i.id === inc.id) : -1
  const step = (delta: number) => { if (queue.length) select(queue[(idx + delta + queue.length) % queue.length].id) }
  const review = s.decisions.filter((x) => x.status === 'approved' && x.review_required)

  return (
    <>
      <OperationalSummary />
      {review.length > 0 && (
        <div className="alert-bar" role="alert">
          <TriangleAlert size={18} aria-hidden />
          <div>
            <b>{review.length} approved dispatch{review.length > 1 ? 'es need' : ' needs'} operator review.</b> Approved dispatches are never changed automatically.
            <ul>
              {review.map((x) => (
                <li key={x.id}>
                  <button type="button" className="link-btn" onClick={() => select(x.incident_id)}>{x.incident_id}</button>
                  {' '}({x.ambulance_id}): {x.alerts.join('; ')}{x.blocked ? '. Unit is holding.' : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div className="dispatch-grid">
        <section className="card map-card area-map" aria-label="Operational map">
          <div className="map-wrap">
            <MapView s={s} selected={d} selectedIncidentId={inc?.id ?? null} layers={layers} focus={focus} onSelectIncident={select} />
            <LayerPanel layers={layers} onChange={setLayers} />
          </div>
        </section>
        <div className="area-queue">
          <IncidentQueue queue={queue} selectedId={inc?.id ?? null} onSelect={select} sortKey={sortKey} onSort={setSortKey} nowIso={s.server_time} />
        </div>
        <div className="area-preview"><RoutePreview d={d} /></div>
        <div className="area-panel">
          <SelectedIncident key={inc?.id ?? 'none'} s={s} inc={inc} d={d} position={idx + 1} total={queue.length}
            onPrev={() => step(-1)} onNext={() => step(1)}
            onLeg={(leg) => setFocus({ leg, nonce: Date.now() })}
            onWhy={() => { const el = document.getElementById('why'); el?.scrollIntoView({ block: 'nearest' }); el?.focus() }} />
        </div>
        <div className="area-explain"><DecisionExplanation s={s} inc={inc} d={d} /></div>
      </div>
    </>
  )
}
