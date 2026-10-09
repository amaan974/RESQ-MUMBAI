// Typed client for the RESQ Mumbai simulation backend (FastAPI, proxied at /api).
export type LatLng = [number, number]

export interface Route {
  node_path: string[]
  edge_ids: string[]
  polyline: LatLng[]
  travel_time_s: number
  length_m: number
  segments: { name: string; edge_ids: string[]; length_m: number }[]
}

export interface Incident {
  id: string
  type: string
  priority: number
  priority_confirmed: boolean
  label: string
  node: string
  lat: number
  lon: number
  status: string
  source: string
  seq: number
  created_at: string
  reason: string | null
  decision_id: string | null
}

export interface Ambulance { id: string; label: string; node: string; status: string; lat: number; lon: number }
export interface Hospital {
  id: string; name: string; node: string; beds_total: number; beds_available: number
  eligible_types: string[]; osm_mapped: boolean; temporary?: boolean; lat: number; lon: number
}

export interface Decision {
  id: string
  incident_id: string
  ambulance_id: string
  hospital_id: string
  route_to_incident: Route
  route_to_hospital: Route
  estimated_ambulance_time_s: number
  estimated_transport_time_s: number
  reason: string[]
  status: string
  created_at: string
  trigger: string
  plan_version: number
  review_required: boolean
  alerts: string[]
  suggested_reroute: { route_to_incident: Route; route_to_hospital: Route } | null
  superseded_by: string | null
  invalidation: string | null
  phase?: 'to_incident' | 'to_hospital' | 'at_hospital'
  blocked?: boolean
  elapsed_s?: number
}

export interface Site { id: string; name: string; lat: number; lon: number; node: string; capacity?: number; people?: number }
export interface Source { layer: string; label: string; source: string; observed_at: string | null; simulated: boolean; license?: string }

export interface EvacPlan {
  origin_id: string; status: string; shelter_id: string | null; route: Route | null; reason: string
  alternatives?: { shelter_id: string; time_s: number }[]
}

export interface ClinicPlan {
  status: string; site_id: string | null; reason: string; rule: string; total_demand_weight: number
  table: { site_id: string; covered_weight: number; covered_ids: string[]; mean_time_s: number | null; unreachable: number }[]
}

export interface Positioning {
  covered_weight: number; total_weight: number; gaps: string[]; idle_ambulances: string[]; rule: string
  recommendation: { ambulance_id: string; staging_site_id: string; covered_weight_after: number; remaining_gaps: string[]; reason: string } | null
}

export interface State {
  server_time: string
  sim_time_s: number
  plan: { version: number; trigger: string; nodes_explored: number; compute_ms: number; at: string; changes: string[]; proven_optimal?: boolean }
  graph: { meta: Record<string, unknown>; nodes: number; edges: number; label: string }
  sources: Source[]
  sos_locations: { id: string; label: string; lat: number; lon: number }[]
  incidents: Incident[]
  ambulances: Ambulance[]
  hospitals: Hospital[]
  decisions: Decision[]
  closed_edges: { edge_id: string; name: string | null; geometry: LatLng[] }[]
  shelters: Site[]
  evacuation_origins: Site[]
  evacuation: Record<string, EvacPlan>
  clinic_sites: Site[]
  clinic: ClinicPlan
  staging_sites: Site[]
  positioning: Positioning
  flood_zones: { id: string; name: string; lat: number; lon: number; radius_m: number }[]
  weather: Weather
  alerts: { t: string; decision_id: string; message: string }[]
  events: { t: string; kind: string; message: string }[]
}

export interface Weather {
  status: string; label: string; reason?: string; source?: string; observed_at?: string
  current_precip_mm?: number; next_6h_precip_mm?: number; note?: string
}

export interface PlanMetrics {
  incidents_total: number; incidents_served: number
  served_by_priority: { high: number; medium: number; low: number }
  total_response_s: number; mean_response_s: number | null; max_response_s: number | null
  mean_high_priority_response_s: number | null; total_chain_s: number; weighted_chain_cost: number; compute_ms?: number
}
export interface Metrics {
  current: { optimizer: PlanMetrics; baseline: PlanMetrics; baseline_priority: PlanMetrics; note: string }
  benchmark: { description: string; optimizer: PlanMetrics; baseline: PlanMetrics; baseline_priority: PlanMetrics }
  definitions: Record<string, string>
}

export interface SuiteSummary {
  runs: number; optimizer_better: number; tie: number; optimizer_worse: number
  served_high_optimizer: number; served_high_baseline: number; served_total_optimizer: number; served_total_baseline: number
  mean_weighted_cost_optimizer: number; mean_weighted_cost_baseline: number
  mean_high_priority_response_s_optimizer: number | null; mean_high_priority_response_s_baseline: number | null
}
export interface Suite {
  description: string; comparison_rule: string; compute_s: number
  overall: SuiteSummary; overall_vs_priority_greedy: SuiteSummary
  by_condition: Record<string, SuiteSummary>; by_condition_vs_priority_greedy: Record<string, SuiteSummary>
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  const data = text ? JSON.parse(text) : null
  if (!r.ok) throw new ApiError(r.status, (data && (data.detail as string)) || r.statusText)
  return data as T
}

export const api = {
  state: () => call<State>('GET', '/state'),
  graph: () => call<{ meta: Record<string, unknown>; edges: { edge_id: string; geometry: LatLng[]; highway: string }[] }>('GET', '/graph'),
  sos: (location_id: string, emergency_type: string, client_token: string) =>
    call<{ request_id: string; status: string; duplicate: boolean; notice: string }>('POST', '/sos', { location_id, emergency_type, client_token }),
  sosStatus: (id: string) => call<{ request_id: string; status: string; priority_confirmed: boolean }>('GET', `/sos/${id}`),
  optimize: () => call<State>('POST', '/optimize'),
  closeOnDecision: (decision_id: string, leg: 'to_incident' | 'to_hospital') => call('POST', '/simulate/close-road', { decision_id, leg }),
  closeEdges: (edge_ids: string[]) => call('POST', '/simulate/close-road', { edge_ids }),
  reopen: () => call('POST', '/simulate/reopen-roads'),
  floodZone: (zone_id: string) => call('POST', '/simulate/flood-zone', { zone_id }),
  weather: () => call<Weather>('GET', '/weather'),
  fillHospital: (hospital_id: string) => call('POST', '/simulate/fill-hospital', { hospital_id }),
  setCapacity: (hospital_id: string, beds: number) => call('POST', '/simulate/set-capacity', { hospital_id, beds }),
  addIncident: () => call('POST', '/simulate/add-incident'),
  advance: (seconds: number) => call('POST', '/simulate/advance', { seconds }),
  setPriority: (id: string, priority: number) => call('POST', `/incidents/${id}/priority`, { priority }),
  approve: (id: string) => call('POST', `/decisions/${id}/approve`),
  acceptReroute: (id: string) => call('POST', `/decisions/${id}/accept-reroute`),
  complete: (id: string) => call('POST', `/decisions/${id}/complete`),
  reset: () => call('POST', '/reset'),
  metrics: () => call<Metrics>('GET', '/metrics'),
  suite: () => call<Suite>('GET', '/benchmark?seeds=30'),
  evacuate: (origin_id: string) => call<EvacPlan>('POST', '/evacuation/plan', { origin_id }),
  deployClinic: (site_id: string, beds: number) => call('POST', '/clinic/deploy', { site_id, beds }),
  applyPositioning: (ambulance_id: string, staging_site_id: string) => call('POST', '/positioning/apply', { ambulance_id, staging_site_id }),
}

export const PRIORITY: Record<number, string> = { 3: 'HIGH', 2: 'MEDIUM', 1: 'LOW' }
export const TYPE_LABEL: Record<string, string> = { medical: 'Medical emergency', flood_rescue: 'Flood rescue', trauma: 'Trauma / injury' }
export const fmtMin = (s: number | null | undefined) => (s == null ? '—' : `${(s / 60).toFixed(1)} min`)
export const fmtKm = (m: number) => `${(m / 1000).toFixed(2)} km`
