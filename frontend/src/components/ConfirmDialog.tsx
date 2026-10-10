import { useEffect, useRef, type ReactNode } from 'react'

/** Native <dialog> confirmation for broad or destructive scenario actions (focus-trapped, Esc cancels). */
export default function ConfirmDialog({ open, title, children, confirmLabel, danger, onConfirm, onCancel }: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onCancel() }} aria-labelledby="dlg-title">
      <h2 id="dlg-title">{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} autoFocus>{confirmLabel}</button>
      </div>
    </dialog>
  )
}
