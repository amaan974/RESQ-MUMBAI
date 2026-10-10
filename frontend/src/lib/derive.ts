// Pure display logic over backend state. No decisions are made here: the backend is authoritative.
import type { Decision, Incident, State } from '../api'

export const PRIORITY_LABEL: Record<number, string> = { 3: 'High', 2: 'Medium', 1: 'Low' }
export const TYPE_LABEL: Record<string, string> = {
  medical: 'Medical emergency', flood_rescue: 'Flood rescue', trauma: 'Trauma / injury',
}
export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending review',
  reviewed: 'Reviewed',
  recommended: 'Recommendation ready',
  infeasible: 'No feasible plan',
  approved: 'Dispatched',
  resolved: 'Resolved',
}
export const PHASE_LABEL: Record<string, string> = {
  to_incident: 'En route to patient',
  to_hospital: 'Patient on board, en route to hospital',
  at_hospital: 'At hospital, awaiting handover confirmation',
}

export const fmtMin = (s: number | null | undefined) => (s == null ? 'n/a' : `${(s / 60).toFixed(1)} min`)
export const fmtKm = (m: number | null | undefined) => (m == null ? 'n/a' : `${(m / 1000).toFixed(2)} km`)
export const fmtClock = (s: number) => `T+${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function activeIncidents(s: State): Incident[] {
  return s.incidents.filter((i) => i.status !== 'resolved')
}

// Lower rank = needs attention sooner.
const STATUS_RANK: Record<string, number> = { infeasible: 0, pending: 1, reviewed: 1, recommended: 2, approved: 3, resolved: 4 }

export type SortKey = 'priority' | 'newest' | 'status'

/** Deterministic queue order. Priority: highest priority, then unapproved before approved, then oldest first. */
export function sortQueue(incs: Incident[], key: SortKey): Incident[] {
  const rank = (i: Incident) => STATUS_RANK[i.status] ?? 5
  const byId = (a: Incident, b: Incident) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return [...incs].sort((a, b) => {
    if (key === 'newest') return b.seq - a.seq || byId(a, b)
    if (key === 'status') return rank(a) - rank(b) || b.priority - a.priority || a.seq - b.seq || byId(a, b)
    return b.priority - a.priority || (Number(a.status === 'approved') - Number(b.status === 'approved')) || a.seq - b.seq || byId(a, b)
  })
}

/** Keep the dispatcher's selection while it exists; otherwise fall back to the head of the queue. */
export function pickSelected(queue: Incident[], selectedId: string | null): Incident | null {
  return queue.find((i) => i.id === selectedId) ?? queue[0] ?? null
}

/** The live (recommended or approved) decision for an incident, if any. */
export function decisionFor(s: State, inc: Incident | null): Decision | null {
  if (!inc) return null
  const live = (d: Decision | undefined) => (d && (d.status === 'recommended' || d.status === 'approved') ? d : undefined)
  const byRef = inc.decision_id ? live(s.decisions.find((d) => d.id === inc.decision_id)) : undefined
  return byRef ?? live(s.decisions.find((d) => d.incident_id === inc.id && (d.status === 'recommended' || d.status === 'approved'))) ?? null
}

export function supersededFor(s: State, incId: string): Decision[] {
  return s.decisions.filter((d) => d.incident_id === incId && d.status === 'superseded').reverse()
}

export interface Summary {
  active: number
  unapproved: number
  byPriority: { 3: number; 2: number; 1: number }
  ambTotal: number
  ambAvailable: number
  ambDispatched: number
  ambOut: number
  hospitalsTotal: number
  hospitalsWithBeds: number
  bedsFree: number
  closedEdges: number
}

export function summarize(s: State): Summary {
  const act = activeIncidents(s)
  const byPriority = { 3: 0, 2: 0, 1: 0 } as Summary['byPriority']
  act.forEach((i) => { if (i.priority === 1 || i.priority === 2 || i.priority === 3) byPriority[i.priority] += 1 })
  return {
    active: act.length,
    unapproved: act.filter((i) => i.status !== 'approved').length,
    byPriority,
    ambTotal: s.ambulances.length,
    ambAvailable: s.ambulances.filter((a) => a.status === 'available').length,
    ambDispatched: s.ambulances.filter((a) => a.status === 'dispatched').length,
    ambOut: s.ambulances.filter((a) => a.status !== 'available' && a.status !== 'dispatched').length,
    hospitalsTotal: s.hospitals.length,
    hospitalsWithBeds: s.hospitals.filter((h) => h.beds_available > 0).length,
    bedsFree: s.hospitals.reduce((n, h) => n + Math.max(0, h.beds_available), 0),
    closedEdges: s.closed_edges.length,
  }
}

export type RouteState = { kind: 'open' | 'review' | 'blocked'; text: string }

export function routeState(d: Decision): RouteState {
  if (d.blocked) return { kind: 'blocked', text: 'Unit holding before a closed road. Reroute needs operator approval.' }
  if (d.review_required) return { kind: 'review', text: `Operator review required: ${d.alerts.join('; ')}` }
  if (d.status === 'approved') return { kind: 'open', text: 'Approved route. No confirmed closure ahead of the unit.' }
  return { kind: 'open', text: 'Route uses only open road edges at the time of calculation.' }
}

/** Elapsed time between two ISO timestamps, both taken from the server clock. */
export function elapsedLabel(fromIso: string, nowIso: string): string {
  const ms = Date.parse(nowIso) - Date.parse(fromIso)
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)} h ${m % 60} min ago`
}
