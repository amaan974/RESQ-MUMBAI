import { HeartPulse } from 'lucide-react'
import type { Incident } from '../api'
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL, elapsedLabel, type SortKey } from '../lib/derive'
import { TYPE_ICON } from '../lib/map'

export function PriorityBadge({ p, confirmed = true }: { p: number; confirmed?: boolean }) {
  return (
    <span className={`badge prio-${p}`}>
      {PRIORITY_LABEL[p] ?? p}{confirmed ? '' : ' (unconfirmed)'}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge st-${status}`}>{STATUS_LABEL[status] ?? status}</span>
}

export default function IncidentQueue({ queue, selectedId, onSelect, sortKey, onSort, nowIso }: {
  queue: Incident[]
  selectedId: string | null
  onSelect: (id: string) => void
  sortKey: SortKey
  onSort: (k: SortKey) => void
  nowIso: string
}) {
  return (
    <section className="card queue" aria-labelledby="queue-h">
      <div className="card-head">
        <h2 id="queue-h">Incident queue <span className="count num">({queue.length})</span></h2>
        <label className="sort">
          <span>Sort by</span>
          <select value={sortKey} onChange={(e) => onSort(e.target.value as SortKey)}>
            <option value="priority">Priority</option>
            <option value="status">Needs attention</option>
            <option value="newest">Newest</option>
          </select>
        </label>
      </div>
      {queue.length === 0 ? (
        <div className="empty">No active incidents. New citizen SOS requests and simulated emergencies appear here automatically.</div>
      ) : (
        <ul className="queue-list">
          {queue.map((i) => {
            const Icon = TYPE_ICON[i.type] ?? HeartPulse
            const sel = i.id === selectedId
            return (
              <li key={i.id}>
                <button type="button" className={`queue-row ${sel ? 'selected' : ''}`} aria-pressed={sel} onClick={() => onSelect(i.id)}>
                  <span className={`type-icon prio-${i.priority}`} aria-hidden><Icon size={16} /></span>
                  <span className="queue-main">
                    <span className="queue-line"><b>{i.id}</b> <span className="muted">{TYPE_LABEL[i.type] ?? i.type}</span></span>
                    <span className="queue-sub">{i.label}</span>
                    <span className="queue-sub"><StatusBadge status={i.status} /></span>
                  </span>
                  <span className="queue-side">
                    <PriorityBadge p={i.priority} confirmed={i.priority_confirmed} />
                    <span className="queue-time">{elapsedLabel(i.created_at, nowIso)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
