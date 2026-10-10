import { CircleCheck, Info, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { Decision, Incident, State } from '../api'

export default function DecisionExplanation({ s, inc, d }: { s: State; inc: Incident | null; d: Decision | null }) {
  return (
    <section id="why" className="card explain" aria-labelledby="why-h" tabIndex={-1}>
      <div className="card-head"><h2 id="why-h">Why this recommendation</h2></div>
      {d ? (
        <ul className="reasons">
          {d.reason.map((r, i) => <li key={i}><CircleCheck size={16} aria-hidden className="ok-icon" /> <span>{r}</span></li>)}
        </ul>
      ) : inc ? (
        <p className="reason-none"><TriangleAlert size={16} aria-hidden /> {inc.reason ?? 'No recommendation has been calculated for this incident.'}</p>
      ) : <p className="muted">Select an incident to see the reasoning behind its recommendation.</p>}
      <div className="plan-facts">
        {s.plan.proven_optimal === false
          ? <p className="warn-text"><TriangleAlert size={14} aria-hidden /> Plan v{s.plan.version}: best feasible plan found within the search limit. Optimality is not proven.</p>
          : <p><ShieldCheck size={14} aria-hidden /> Plan v{s.plan.version}: proven optimal by exact branch-and-bound over all unapproved incidents ({s.plan.compute_ms} ms).</p>}
        <p className="muted"><Info size={14} aria-hidden /> Objective: serve as many incidents as possible, High priority first, then minimise priority-weighted response plus transport time.
          Constraints: one incident per ambulance, simulated free beds, hospital eligibility for the incident type, and open directed road edges only.</p>
      </div>
    </section>
  )
}
