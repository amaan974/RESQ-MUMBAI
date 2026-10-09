import { useEffect, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api, fmtMin, PRIORITY, type Decision, type LatLng, type State } from './api'

const icon = (cls: string, text: string) =>
  L.divIcon({ className: '', html: `<div class="pin ${cls}">${text}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })

// Fit the map to a decision's route only when the selected decision changes (not on every poll).
function FitToDecision({ d }: { d: Decision | null }) {
  const map = useMap()
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (!d || d.id === last.current) return
    last.current = d.id
    const pts = [...d.route_to_incident.polyline, ...d.route_to_hospital.polyline]
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 })
  }, [d, map])
  return null
}

export interface Layers { tiles: boolean; network: boolean; flood: boolean; others: boolean; evac: boolean; sites: boolean }

export default function MapView({ s, selected, layers, evacOrigin, onSelectIncident }: {
  s: State
  selected: Decision | null
  layers: Layers
  evacOrigin: string | null
  onSelectIncident: (id: string) => void
}) {
  const [network, setNetwork] = useState<LatLng[][]>([])
  useEffect(() => {
    api.graph().then((g) => setNetwork(g.edges.map((e) => e.geometry))).catch(() => setNetwork([]))
  }, [])

  const others = s.decisions.filter((d) => (d.status === 'recommended' || d.status === 'approved') && d.id !== selected?.id)
  const evac = evacOrigin ? s.evacuation[evacOrigin] : null
  const clinicId = s.clinic.site_id
  const posRec = s.positioning.recommendation

  return (
    <MapContainer center={[19.0575, 72.88]} zoom={14} style={{ height: '100%', width: '100%' }} preferCanvas>
      {layers.tiles && (
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      )}
      <FitToDecision d={selected} />
      {layers.network && network.map((g, i) => (
        <Polyline key={`n${i}`} positions={g} pathOptions={{ color: '#334155', weight: 1.6, opacity: 0.7 }} interactive={false} />
      ))}
      {layers.flood && s.flood_zones.map((z) => (
        <Circle key={z.id} center={[z.lat, z.lon]} radius={z.radius_m}
          pathOptions={{ color: '#2563eb', weight: 1, dashArray: '4 4', fillColor: '#60a5fa', fillOpacity: 0.18 }}>
          <Tooltip>{z.name} — SCENARIO flood-susceptibility zone (hypothetical, not a forecast; does not close roads)</Tooltip>
        </Circle>
      ))}
      {s.closed_edges.map((e) => (
        <Polyline key={e.edge_id} positions={e.geometry} pathOptions={{ color: '#dc2626', weight: 7, opacity: 0.9 }}>
          <Tooltip>CLOSED (simulated): {e.name ?? 'unnamed road'} · {e.edge_id}</Tooltip>
        </Polyline>
      ))}
      {layers.others && others.map((d) => (
        <span key={d.id}>
          <Polyline positions={d.route_to_incident.polyline}
            pathOptions={{ color: d.status === 'approved' ? '#7c3aed' : '#1d4ed8', weight: 3, opacity: 0.45 }} />
          <Polyline positions={d.route_to_hospital.polyline}
            pathOptions={{ color: d.status === 'approved' ? '#7c3aed' : '#15803d', weight: 3, opacity: 0.45, dashArray: '6 6' }} />
        </span>
      ))}
      {selected && (
        <>
          <Polyline positions={selected.route_to_incident.polyline} pathOptions={{ color: '#1d4ed8', weight: 6 }}>
            <Tooltip sticky>{selected.ambulance_id} → {selected.incident_id}: {fmtMin(selected.estimated_ambulance_time_s)}</Tooltip>
          </Polyline>
          <Polyline positions={selected.route_to_hospital.polyline} pathOptions={{ color: '#15803d', weight: 6, dashArray: '10 8' }}>
            <Tooltip sticky>{selected.incident_id} → {selected.hospital_id}: {fmtMin(selected.estimated_transport_time_s)}</Tooltip>
          </Polyline>
          {selected.suggested_reroute && (
            <>
              <Polyline positions={selected.suggested_reroute.route_to_incident.polyline} pathOptions={{ color: '#ea580c', weight: 4, dashArray: '2 8' }} />
              <Polyline positions={selected.suggested_reroute.route_to_hospital.polyline} pathOptions={{ color: '#ea580c', weight: 4, dashArray: '2 8' }} />
            </>
          )}
        </>
      )}
      {layers.evac && evac?.route && (
        <Polyline positions={evac.route.polyline} pathOptions={{ color: '#0d9488', weight: 5, dashArray: '1 7', lineCap: 'round' }}>
          <Tooltip sticky>Evacuation {evac.origin_id} → {evac.shelter_id}</Tooltip>
        </Polyline>
      )}
      {layers.sites && s.evacuation_origins.map((o) => (
        <CircleMarker key={o.id} center={[o.lat, o.lon]} radius={7} pathOptions={{ color: '#0d9488', fillOpacity: 0.6 }}>
          <Tooltip>{o.name} · {o.people} people (scenario)</Tooltip>
        </CircleMarker>
      ))}
      {layers.sites && s.shelters.map((x) => (
        <Marker key={x.id} position={[x.lat, x.lon]} icon={icon('shelter', '⌂')}>
          <Tooltip>{x.name} · capacity {x.capacity} (simulated)</Tooltip>
        </Marker>
      ))}
      {layers.sites && s.clinic_sites.map((x) => (
        <Marker key={x.id} position={[x.lat, x.lon]} icon={icon(x.id === clinicId ? 'clinic chosen' : 'clinic', '+')}>
          <Tooltip>{x.name}{x.id === clinicId ? ' — RECOMMENDED temporary medical site' : ' — candidate'}</Tooltip>
        </Marker>
      ))}
      {layers.sites && posRec && (() => {
        const st = s.staging_sites.find((x) => x.id === posRec.staging_site_id)
        return st ? (
          <Marker position={[st.lat, st.lon]} icon={icon('staging', 'P')}>
            <Tooltip>Suggested waiting point for {posRec.ambulance_id}: {st.name}</Tooltip>
          </Marker>
        ) : null
      })()}
      {s.hospitals.map((h) => (
        <Marker key={h.id} position={[h.lat, h.lon]} icon={icon(`${h.beds_available > 0 ? 'hosp' : 'hosp full'}${h.temporary ? ' tmp' : ''}`, h.temporary ? 'T' : 'H')}>
          <Tooltip>{h.id} {h.name} · {h.beds_available} simulated beds free · {h.eligible_types.join(', ')}</Tooltip>
        </Marker>
      ))}
      {s.ambulances.map((a) => (
        <Marker key={a.id} position={[a.lat, a.lon]} icon={icon(`amb ${a.status}`, '🚑')}>
          <Tooltip>{a.id} ({a.label}) · {a.status} (simulated position)</Tooltip>
        </Marker>
      ))}
      {s.incidents.filter((i) => i.status !== 'resolved').map((i) => (
        <Marker key={i.id} position={[i.lat, i.lon]} icon={icon(`inc p${i.priority} ${i.status}`, '!')}
          eventHandlers={{ click: () => onSelectIncident(i.id) }}>
          <Tooltip>{i.id} · {i.type} · {PRIORITY[i.priority]} · {i.status}</Tooltip>
        </Marker>
      ))}
    </MapContainer>
  )
}
