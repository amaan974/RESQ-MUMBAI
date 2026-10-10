import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Send, Stethoscope, TriangleAlert, Waves } from 'lucide-react'
import { api, type State } from './api'

function clientToken(): string {
  // Random non-personal token so the server can suppress accidental duplicate submissions.
  try {
    let t = sessionStorage.getItem('resq_token')
    if (!t) { t = Math.random().toString(36).slice(2, 12); sessionStorage.setItem('resq_token', t) }
    return t
  } catch {
    return 'no-storage'
  }
}

const STATUS_TEXT: Record<string, string> = {
  pending: 'Received in the simulated dispatcher queue.',
  reviewed: 'Reviewed by the simulated dispatcher.',
  recommended: 'A unit and hospital plan has been calculated. Waiting for dispatcher approval.',
  infeasible: 'No feasible unit or hospital right now. The dispatcher has been alerted (simulation).',
  approved: 'The dispatcher approved a simulated ambulance.',
  resolved: 'Closed (simulation).',
}

const TYPES = [
  { id: 'medical' as const, label: 'Medical emergency', icon: Stethoscope },
  { id: 'flood_rescue' as const, label: 'Flood rescue', icon: Waves },
]

export default function SosPage() {
  const [locs, setLocs] = useState<State['sos_locations']>([])
  const [loc, setLoc] = useState('kurla')
  const [typ, setTyp] = useState<'medical' | 'flood_rescue'>('medical')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ id: string; duplicate: boolean } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    api.state().then((s) => setLocs(s.sos_locations)).catch((e) => setErr(`Backend unreachable: ${e.message}`))
  }, [])

  useEffect(() => {
    if (!result) return
    const poll = () => api.sosStatus(result.id).then((r) => setStatus(r.status)).catch(() => undefined)
    poll()
    const t = setInterval(poll, 2500)
    return () => clearInterval(t)
  }, [result])

  const send = async () => {
    if (inFlight.current || result) return // repeated-click suppression (client side; server also de-duplicates)
    inFlight.current = true
    setSending(true)
    setErr(null)
    try {
      const r = await api.sos(loc, typ, clientToken())
      setResult({ id: r.request_id, duplicate: r.duplicate })
      setStatus(r.status)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSending(false)
      inFlight.current = false
    }
  }

  return (
    <div className="sos-page">
      <div className="sim-notice" role="note">Research simulation. Not for real emergency use.</div>
      <main className="sos-card">
        <h1>RESQ Mumbai citizen SOS</h1>
        <p className="sos-warn" role="alert">
          <TriangleAlert size={18} aria-hidden />
          <span><b>SIMULATION ONLY. DOES NOT CONTACT EMERGENCY SERVICES.</b> In a real emergency call <b>112</b> or <b>108</b>.</span>
        </p>
        <p className="muted small">No name, phone number, diagnosis or GPS position is collected. Choose one of three predefined demonstration locations.</p>

        <fieldset className="choice-group" disabled={!!result || sending}>
          <legend>Emergency type</legend>
          <div className="choice">
            {TYPES.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" className={typ === id ? 'on' : ''} aria-pressed={typ === id} onClick={() => setTyp(id)}>
                <Icon size={18} aria-hidden /> {label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="choice-group" disabled={!!result || sending}>
          <legend>Demonstration location</legend>
          <div className="choice">
            {locs.map((l) => (
              <button key={l.id} type="button" className={loc === l.id ? 'on' : ''} aria-pressed={loc === l.id} onClick={() => setLoc(l.id)}>
                <MapPin size={18} aria-hidden /> {l.label}
              </button>
            ))}
          </div>
        </fieldset>

        {!result ? (
          <button type="button" className="sos-btn" disabled={sending || locs.length === 0} onClick={send}>
            <Send size={18} aria-hidden /> {sending ? 'Sending' : 'Send simulated SOS'}
          </button>
        ) : (
          <div className="sos-result" role="status" aria-live="polite">
            <div className="muted">Request ID</div>
            <div className="rid">{result.id}</div>
            {result.duplicate && <div className="warn-text small">Duplicate submission suppressed. Showing your existing request.</div>}
            <div className="status">Status: <b>{status}</b></div>
            <div className="small">{status ? STATUS_TEXT[status] ?? status : ''}</div>
            <button type="button" className="link-btn" onClick={() => { setResult(null); setStatus(null) }}>Send a different simulated SOS</button>
          </div>
        )}
        {err && <p className="bad-text" role="alert">{err}</p>}
        <p className="small muted foot">Status reflects the shared simulated dispatcher state. <Link to="/">Dispatcher view</Link></p>
      </main>
    </div>
  )
}
