// One shared polling loop over the backend state for every page. The backend stays authoritative:
// this only holds the last snapshot, connectivity, the dispatcher's selection and action feedback.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type State } from './api'

const POLL_MS = 2000
const STALE_MS = 10000

export interface Toast { kind: 'ok' | 'err'; text: string }

interface Sim {
  s: State | null
  error: string | null
  lastOkAt: number | null
  /** Backend reachable and the snapshot is fresh: state-changing controls may be used. */
  online: boolean
  busy: boolean
  toast: Toast | null
  selectedId: string | null
  select: (id: string | null) => void
  refresh: () => Promise<void>
  /** Run a backend action, then refresh. Returns true on success. */
  act: (label: string, fn: () => Promise<unknown>) => Promise<boolean>
}

const Ctx = createContext<Sim | null>(null)

export function SimProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastOkAt, setLastOkAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [selectedId, select] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const reqSeq = useRef(0)
  const appliedSeq = useRef(0)
  const inFlight = useRef(false)
  const toastTimer = useRef<number | undefined>(undefined)

  const refresh = useCallback(async () => {
    const seq = ++reqSeq.current
    inFlight.current = true
    try {
      const next = await api.state()
      if (seq > appliedSeq.current) { // never let an older response overwrite a newer one
        appliedSeq.current = seq
        setS(next)
        setError(null)
        setLastOkAt(Date.now())
      }
    } catch (e) {
      if (seq > appliedSeq.current) setError((e as Error).message)
    } finally {
      if (seq === reqSeq.current) inFlight.current = false
    }
  }, [])

  useEffect(() => {
    const tick = () => { if (!inFlight.current) void refresh(); setNow(Date.now()) }
    tick()
    const t = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(t)
  }, [refresh])

  useEffect(() => {
    // Populates the backend's rainfall-context cache (display only; never used for decisions).
    const w = () => api.weather().catch(() => undefined)
    void w()
    const t = window.setInterval(w, 600000)
    return () => window.clearInterval(t)
  }, [])

  const act = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    let ok = false
    try {
      await fn()
      ok = true
      setToast({ kind: 'ok', text: label })
    } catch (e) {
      setToast({ kind: 'err', text: `${label} failed: ${(e as Error).message}` })
    } finally {
      setBusy(false)
      await refresh()
      window.clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setToast(null), 6000)
    }
    return ok
  }, [refresh])

  const stale = lastOkAt === null || now - lastOkAt > STALE_MS
  const online = s !== null && error === null && !stale

  return (
    <Ctx.Provider value={{ s, error, lastOkAt, online, busy, toast, selectedId, select, refresh, act }}>
      {children}
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSim(): Sim {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSim must be used inside SimProvider')
  return v
}
