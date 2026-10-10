import { describe, expect, it } from 'vitest'
import type { Decision, Incident, State } from '../api'
import { activeIncidents, decisionFor, elapsedLabel, fmtClock, fmtMin, pickSelected, routeState, sortQueue, summarize } from './derive'

const inc = (id: string, priority: number, status: string, seq: number, extra: Partial<Incident> = {}): Incident => ({
  id, type: 'medical', priority, priority_confirmed: true, label: id, node: 'n', lat: 19, lon: 72, status, source: 'scenario_seed',
  seq, created_at: '2026-10-10T10:00:00+00:00', reason: null, decision_id: null, ...extra,
})

const route = { node_path: [], edge_ids: ['e'], polyline: [], travel_time_s: 60, length_m: 500, segments: [] }
const dec = (id: string, incident_id: string, status: string, extra: Partial<Decision> = {}): Decision => ({
  id, incident_id, ambulance_id: 'AMB-01', hospital_id: 'HOSP-A', route_to_incident: route, route_to_hospital: route,
  estimated_ambulance_time_s: 60, estimated_transport_time_s: 60, reason: [], status, created_at: '', trigger: '', plan_version: 1,
  review_required: false, alerts: [], suggested_reroute: null, superseded_by: null, invalidation: null, ...extra,
})

const state = (incidents: Incident[], decisions: Decision[] = []): State => ({
  incidents, decisions, ambulances: [
    { id: 'AMB-01', label: 'a', node: 'n', status: 'available', lat: 0, lon: 0 },
    { id: 'AMB-02', label: 'b', node: 'n', status: 'dispatched', lat: 0, lon: 0 },
    { id: 'AMB-03', label: 'c', node: 'n', status: 'out_of_service', lat: 0, lon: 0 },
  ],
  hospitals: [
    { id: 'H1', name: 'H1', node: 'n', beds_total: 5, beds_available: 2, eligible_types: ['medical'], osm_mapped: true, lat: 0, lon: 0 },
    { id: 'H2', name: 'H2', node: 'n', beds_total: 5, beds_available: 0, eligible_types: ['medical'], osm_mapped: true, lat: 0, lon: 0 },
  ],
  closed_edges: [{ edge_id: 'x', name: null, geometry: [] }],
} as unknown as State)

describe('sortQueue', () => {
  const q = [inc('A', 1, 'recommended', 1), inc('B', 3, 'approved', 2), inc('C', 3, 'recommended', 3), inc('D', 2, 'infeasible', 4)]
  it('orders by priority, unapproved before approved, then oldest first', () => {
    expect(sortQueue(q, 'priority').map((i) => i.id)).toEqual(['C', 'B', 'D', 'A'])
  })
  it('orders newest first', () => {
    expect(sortQueue(q, 'newest').map((i) => i.id)).toEqual(['D', 'C', 'B', 'A'])
  })
  it('orders by attention needed (infeasible first, approved last)', () => {
    expect(sortQueue(q, 'status').map((i) => i.id)).toEqual(['D', 'C', 'A', 'B'])
  })
  it('does not mutate its input', () => {
    const copy = [...q]
    sortQueue(q, 'priority')
    expect(q).toEqual(copy)
  })
})

describe('selection', () => {
  const q = [inc('A', 3, 'recommended', 1), inc('B', 2, 'recommended', 2)]
  it('keeps the chosen incident across polls', () => expect(pickSelected(q, 'B')?.id).toBe('B'))
  it('falls back to the head of the queue when the choice disappears', () => expect(pickSelected(q, 'Z')?.id).toBe('A'))
  it('returns null for an empty queue', () => expect(pickSelected([], 'A')).toBeNull())
})

describe('decisionFor', () => {
  it('returns the live decision referenced by the incident', () => {
    const s = state([inc('A', 3, 'recommended', 1, { decision_id: 'D2' })], [dec('D1', 'A', 'superseded'), dec('D2', 'A', 'recommended')])
    expect(decisionFor(s, s.incidents[0])?.id).toBe('D2')
  })
  it('never returns a superseded decision', () => {
    const s = state([inc('A', 3, 'infeasible', 1, { decision_id: 'D1' })], [dec('D1', 'A', 'superseded')])
    expect(decisionFor(s, s.incidents[0])).toBeNull()
  })
  it('finds an approved decision without a reference', () => {
    const s = state([inc('A', 3, 'approved', 1)], [dec('D3', 'A', 'approved')])
    expect(decisionFor(s, s.incidents[0])?.id).toBe('D3')
  })
})

describe('summarize', () => {
  it('derives counts from backend state, separating hospitals from beds', () => {
    const s = state([inc('A', 3, 'recommended', 1), inc('B', 2, 'approved', 2), inc('C', 1, 'resolved', 3)])
    const m = summarize(s)
    expect(m.active).toBe(2)
    expect(m.unapproved).toBe(1)
    expect(m.byPriority).toEqual({ 3: 1, 2: 1, 1: 0 })
    expect([m.ambAvailable, m.ambDispatched, m.ambOut, m.ambTotal]).toEqual([1, 1, 1, 3])
    expect([m.hospitalsWithBeds, m.hospitalsTotal, m.bedsFree]).toEqual([1, 2, 2])
    expect(m.closedEdges).toBe(1)
    expect(activeIncidents(s).map((i) => i.id)).toEqual(['A', 'B'])
  })
})

describe('routeState and formatting', () => {
  it('reports blocked, review and open states', () => {
    expect(routeState(dec('D', 'A', 'approved', { blocked: true, review_required: true })).kind).toBe('blocked')
    expect(routeState(dec('D', 'A', 'approved', { review_required: true, alerts: ['x'] })).kind).toBe('review')
    expect(routeState(dec('D', 'A', 'recommended')).kind).toBe('open')
  })
  it('formats times and clocks without em dashes', () => {
    expect(fmtMin(90)).toBe('1.5 min')
    expect(fmtMin(null)).toBe('n/a')
    expect(fmtClock(185)).toBe('T+3:05')
    expect(elapsedLabel('2026-10-10T10:00:00Z', '2026-10-10T10:00:30Z')).toBe('just now')
    expect(elapsedLabel('2026-10-10T10:00:00Z', '2026-10-10T10:07:10Z')).toBe('7 min ago')
    expect(elapsedLabel('2026-10-10T10:00:00Z', '2026-10-10T11:05:00Z')).toBe('1 h 5 min ago')
  })
})
