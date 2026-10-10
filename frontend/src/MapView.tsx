import { useEffect, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Layers as LayersIcon, X } from 'lucide-react'
import { api, type Decision, type LatLng, type State } from './api'
import { PRIORITY_LABEL, TYPE_LABEL, fmtMin } from './lib/derive'
import type { Focus, Layers } from './lib/map'

// Lucide "ambulance" glyph (ISC licence) as a static string for Leaflet divIcons.
const AMB_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 10H6"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14"/><path d="M8 8v4"/><path d="M9 18h6"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>'

const pin = (cls: string, html: string, size = 26) =>
  L.divIcon({ className: '', html: `<div class="pin ${cls}">${html}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })

// The full road graph is large: fetch it once per session, not per map or per poll.
let graphCache: Promise<LatLng[][]> | null = null
const loadGraph = () => {
  graphCache ??= api.graph().then((g) => g.edges.map((e) => e.geometry)).catch((e) => { graphCache = null; throw e })
  return graphCache
}


function pointsFor(d: Decision, leg: Focus['leg']): LatLng[] {
  if (leg === 'to_incident') return d.route_to_incident.polyline
  if (leg === 'to_hospital') return d.route_to_hospital.polyline
  return [...d.route_to_incident.polyline, ...d.route_to_hospital.polyline]
}

/** Fit to the selected decision when the selection changes, or when the operator asks to view a leg.
 *  Polling never moves the map. */
function FitControl({ d, focus }: { d: Decision | null; focus: Focus | null }) {
  const map = useMap()
  const lastId = useRef<string | null>(null)
  const lastNonce = useRef<number>(-1)
  useEffect(() => {
    if (!d) return
    let leg: Focus['leg'] | null = null
    if (focus && focus.nonce !== lastNonce.current) { lastNonce.current = focus.nonce; leg = focus.leg }
    else if (d.id !== lastId.current) leg = 'all'
    lastId.current = d.id
    if (!leg) return
    const pts = pointsFor(d, leg)
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 16 })
  }, [d, focus, map])
  return null
}

const LAYER_ROWS: { key: keyof Layers; label: string; swatch: string }[] = [
  { key: 'incidents', label: 'Incidents', swatch: 'sw-inc' },
  { key: 'ambulances', label: 'Ambulances', swatch: 'sw-amb' },
  { key: 'hospitals', label: 'Hospitals', swatch: 'sw-hosp' },
  { key: 'closures', label: 'Road closures (confirmed, simulated)', swatch: 'sw-closed' },
  { key: 'flood', label: 'Flood zones (hypothetical)', swatch: 'sw-flood' },
  { key: 'evac', label: 'Evacuation route', swatch: 'sw-evac' },
  { key: 'sites', label: 'Shelters and medical sites', swatch: 'sw-site' },
  { key: 'others', label: 'Other dispatch routes', swatch: 'sw-other' },
  { key: 'tiles', label: 'Base map tiles (online)', swatch: 'sw-tiles' },
  { key: 'network', label: 'Routable OSM graph (offline)', swatch: 'sw-net' },
]

export function LayerPanel({ layers, onChange }: { layers: Layers; onChange: (l: Layers) => void }) {
  // Open by default only where the map is wide enough not to be covered by the panel.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1280)
  if (!open) {
    return (
      <button type="button" className="layer-toggle" onClick={() => setOpen(true)} aria-expanded={false}>
        <LayersIcon size={16} aria-hidden /> Layers
      </button>
    )
  }
  return (
    <fieldset className="layer-panel">
      <div className="layer-head">
        <legend>Map layers</legend>
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Hide layer panel"><X size={16} /></button>
      </div>
      {LAYER_ROWS.map((r) => (
        <label key={r.key} className="layer-row">
          <input type="checkbox" checked={layers[r.key]} onChange={(e) => onChange({ ...layers, [r.key]: e.target.checked })} />
          <span className={`sw ${r.swatch}`} aria-hidden />
          {r.label}
        </label>
      ))}
      <div className="layer-legend">
        <span><i className="ln ln-blue" aria-hidden />Ambulance to patient</span>
        <span><i className="ln ln-green" aria-hidden />Patient to hospital</span>
        <span><i className="ln ln-amber" aria-hidden />Suggested reroute</span>
      </div>
    </fieldset>
  )
}

export default function MapView({ s, selected, selectedIncidentId, layers, evacOrigin, focus, onSelectIncident }: {
  s: State
  selected: Decision | null
  selectedIncidentId: string | null
  layers: Layers
  evacOrigin?: string | null
  focus?: Focus | null
  onSelectIncident?: (id: string) => void
}) {
  const [network, setNetwork] = useState<LatLng[][]>([])
  useEffect(() => {
    if (!layers.network || network.length) return
    loadGraph().then(setNetwork).catch(() => setNetwork([]))
  }, [layers.network, network.length])

  const others = s.decisions.filter((d) => (d.status === 'recommended' || d.status === 'approved') && d.id !== selected?.id)
  const evac = evacOrigin ? s.evacuation[evacOrigin] : null
  const clinicId = s.clinic.site_id
  const posRec = s.positioning.recommendation

  return (
    <MapContainer center={[19.0575, 72.88]} zoom={14} style={{ height: '100%', width: '100%' }} preferCanvas zoomControl={false}
      aria-label="Map of the Kurla, Sion and Chunabhatti pilot area">
      <ZoomControl position="topright" />
      {layers.tiles && (
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      )}
      <FitControl d={selected} focus={focus ?? null} />
      {layers.network && network.map((g, i) => (
        <Polyline key={`n${i}`} positions={g} pathOptions={{ color: '#334155', weight: 1.6, opacity: 0.7 }} interactive={false} />
      ))}
      {layers.flood && s.flood_zones.map((z) => (
        <Circle key={z.id} center={[z.lat, z.lon]} radius={z.radius_m}
          pathOptions={{ color: '#244D82', weight: 1, dashArray: '4 4', fillColor: '#5B8FD0', fillOpacity: 0.16 }}>
          <Tooltip>{z.name}: hypothetical flood-susceptibility zone. Not a forecast and does not close roads.</Tooltip>
        </Circle>
      ))}
      {layers.closures && s.closed_edges.map((e) => (
        <span key={e.edge_id}>
          <Polyline positions={e.geometry} pathOptions={{ color: '#B93A42', weight: 7, opacity: 0.95 }}>
            <Tooltip>Closed (simulated): {e.name ?? 'unnamed road'}</Tooltip>
          </Polyline>
          <Polyline positions={e.geometry} pathOptions={{ color: '#ffffff', weight: 2, dashArray: '4 6', opacity: 0.95 }} interactive={false} />
        </span>
      ))}
      {layers.others && others.map((d) => (
        <span key={d.id}>
          <Polyline positions={d.route_to_incident.polyline}
            pathOptions={{ color: d.status === 'approved' ? '#5B4B8A' : '#244D82', weight: 3, opacity: 0.4 }} />
          <Polyline positions={d.route_to_hospital.polyline}
            pathOptions={{ color: d.status === 'approved' ? '#5B4B8A' : '#23734D', weight: 3, opacity: 0.4, dashArray: '6 6' }} />
        </span>
      ))}
      {selected && (
        <>
          <Polyline positions={selected.route_to_incident.polyline} pathOptions={{ color: '#1F5BB5', weight: 6 }}>
            <Tooltip sticky>{selected.ambulance_id} to {selected.incident_id}: {fmtMin(selected.estimated_ambulance_time_s)}{selected.status === 'approved' ? ' (approved)' : ''}</Tooltip>
          </Polyline>
          <Polyline positions={selected.route_to_hospital.polyline} pathOptions={{ color: '#23734D', weight: 6, dashArray: '10 8' }}>
            <Tooltip sticky>{selected.incident_id} to {selected.hospital_id}: {fmtMin(selected.estimated_transport_time_s)}{selected.status === 'approved' ? ' (approved)' : ''}</Tooltip>
          </Polyline>
          {selected.suggested_reroute && (
            <>
              <Polyline positions={selected.suggested_reroute.route_to_incident.polyline} pathOptions={{ color: '#AD6A23', weight: 4, dashArray: '2 8' }}>
                <Tooltip sticky>Suggested reroute: needs operator approval</Tooltip>
              </Polyline>
              <Polyline positions={selected.suggested_reroute.route_to_hospital.polyline} pathOptions={{ color: '#AD6A23', weight: 4, dashArray: '2 8' }}>
                <Tooltip sticky>Suggested reroute: needs operator approval</Tooltip>
              </Polyline>
            </>
          )}
        </>
      )}
      {layers.evac && evac?.route && (
        <Polyline positions={evac.route.polyline} pathOptions={{ color: '#0F766E', weight: 5, dashArray: '1 7', lineCap: 'round' }}>
          <Tooltip sticky>Evacuation {evac.origin_id} to {evac.shelter_id}</Tooltip>
        </Polyline>
      )}
      {layers.evac && s.evacuation_origins.map((o) => (
        <CircleMarker key={o.id} center={[o.lat, o.lon]} radius={7} pathOptions={{ color: '#0F766E', fillOpacity: 0.6 }}>
          <Tooltip>{o.name}: {o.people} people (scenario)</Tooltip>
        </CircleMarker>
      ))}
      {layers.sites && s.shelters.map((x) => (
        <Marker key={x.id} position={[x.lat, x.lon]} icon={pin('shelter', 'S', 24)}>
          <Tooltip>{x.name}: capacity {x.capacity} (simulated)</Tooltip>
        </Marker>
      ))}
      {layers.sites && s.clinic_sites.map((x) => (
        <Marker key={x.id} position={[x.lat, x.lon]} icon={pin(x.id === clinicId ? 'clinic chosen' : 'clinic', '+', 24)}>
          <Tooltip>{x.name}{x.id === clinicId ? ': recommended temporary medical site' : ': candidate site'}</Tooltip>
        </Marker>
      ))}
      {layers.sites && posRec && (() => {
        const st = s.staging_sites.find((x) => x.id === posRec.staging_site_id)
        return st ? (
          <Marker position={[st.lat, st.lon]} icon={pin('staging', 'P', 24)}>
            <Tooltip>Suggested waiting point for {posRec.ambulance_id}: {st.name}</Tooltip>
          </Marker>
        ) : null
      })()}
      {layers.hospitals && s.hospitals.map((h) => (
        <Marker key={h.id} position={[h.lat, h.lon]}
          icon={pin(`hosp${h.beds_available > 0 ? '' : ' full'}${h.temporary ? ' tmp' : ''}${selected?.hospital_id === h.id ? ' sel' : ''}`, h.temporary ? 'T' : 'H')}>
          <Tooltip>{h.id} {h.name}: {h.beds_available} simulated beds free. Accepts {h.eligible_types.join(', ').replace(/_/g, ' ')}</Tooltip>
        </Marker>
      ))}
      {layers.ambulances && s.ambulances.map((a) => (
        <Marker key={a.id} position={[a.lat, a.lon]} icon={pin(`amb ${a.status}${selected?.ambulance_id === a.id ? ' sel' : ''}`, AMB_SVG)}>
          <Tooltip>{a.id} ({a.label} base): {a.status.replace(/_/g, ' ')}, simulated position</Tooltip>
        </Marker>
      ))}
      {layers.incidents && s.incidents.filter((i) => i.status !== 'resolved').map((i) => (
        <Marker key={i.id} position={[i.lat, i.lon]} icon={pin(`inc p${i.priority} ${i.status}${i.id === selectedIncidentId ? ' sel' : ''}`, '!')}
          eventHandlers={onSelectIncident ? { click: () => onSelectIncident(i.id) } : undefined}
          keyboard title={`${i.id}, ${TYPE_LABEL[i.type] ?? i.type}, ${PRIORITY_LABEL[i.priority]} priority`}>
          {/* react-leaflet applies `permanent` only at creation, so remount when selection changes */}
          <Tooltip key={i.id === selectedIncidentId ? 'sel' : 'hover'} permanent={i.id === selectedIncidentId} direction="right" offset={[12, 0]}>
            {i.id === selectedIncidentId ? i.id : `${i.id}: ${TYPE_LABEL[i.type] ?? i.type}, ${PRIORITY_LABEL[i.priority]} priority, ${i.status}`}
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  )
}
