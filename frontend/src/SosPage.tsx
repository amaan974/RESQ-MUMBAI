import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type State } from './api'
import { Banner } from './Banner'

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
  pending: 'Received by simulated dispatcher queue',
  reviewed: 'Reviewed by simulated dispatcher',
  recommended: 'A unit/hospital plan has been computed — awaiting dispatcher approval',
  infeasible: 'No feasible unit/hospital right now — dispatcher alerted (simulation)',
  approved: 'Dispatcher approved a (simulated) ambulance',
  resolved: 'Closed (simulation)',
}

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
      <Banner />
      <div className="sos-card">
        <h1>RESQ Mumbai — Citizen SOS <span className="badge b-sim">DEMO</span></h1>
        <p className="sos-warn">SIMULATION ONLY — DOES NOT CONTACT EMERGENCY SERVICES. In a real emergency call <b>112</b> / <b>108</b>.</p>
        <p className="small muted">No name, phone number, diagnosis or GPS is collected. You choose one of three predefined demo locations.</p>

        <fieldset disabled={!!result || sending}>
          <legend>Emergency type</legend>
          <div className="choice">
            <button className={typ === 'medical' ? 'on' : ''} onClick={() => setTyp('medical')}>🩺 Medical emergency</button>
            <button className={typ === 'flood_rescue' ? 'on' : ''} onClick={() => setTyp('flood_rescue')}>🌊 Flood rescue</button>
          </div>
          <legend>Demo location</legend>
          <div className="choice">
            {locs.map((l) => (
              <button key={l.id} className={loc === l.id ? 'on' : ''} onClick={() => setLoc(l.id)}>📍 {l.label}</button>
            ))}
          </div>
        </fieldset>

        {!result ? (
          <button className="sos-btn" disabled={sending || locs.length === 0} onClick={send}>
            {sending ? 'Sending…' : 'SEND SIMULATED SOS'}
          </button>
        ) : (
          <div className="sos-result">
            <div>Request ID</div>
            <div className="rid">{result.id}</div>
            {result.duplicate && <div className="warn-text small">Duplicate submission suppressed — showing your existing request.</div>}
            <div className="status">Status: <b>{status}</b></div>
            <div className="small">{status ? STATUS_TEXT[status] ?? status : ''}</div>
            <button className="link-btn" onClick={() => { setResult(null); setStatus(null) }}>Send a different simulated SOS</button>
          </div>
        )}
        {err && <div className="bad-text">{err}</div>}
        <div className="small muted foot">Status reflects the simulated dispatcher state on the shared backend. <Link to="/">Dispatcher dashboard</Link></div>
      </div>
    </div>
  )
}
