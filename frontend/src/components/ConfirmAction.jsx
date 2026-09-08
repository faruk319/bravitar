import { useRef, useState } from 'react'

/**
 * A destructive action, behind a question that names the consequence.
 *
 * Uses <dialog>, not window.confirm — that one can't be styled and blocks the
 * whole page. Deliberately not used for everything: if every button asks, the
 * asking gets clicked through and protects nothing. Reversible actions stay
 * one click.
 *
 * onConfirm may throw; the message lands in the dialog and it stays open.
 */
export default function ConfirmAction({
  label,
  heading,
  detail,
  confirmLabel = 'Yes, do it',
  busyLabel = 'Working…',
  className = 'link',
  disabled = false,
  onConfirm,
}) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      ref.current?.close()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  return (
    <>
      <button
        type="button" className={className} disabled={disabled}
        onClick={() => { setError(null); ref.current?.showModal() }}
      >
        {label}
      </button>

      <dialog ref={ref} className="confirm">
        <h2>{heading}</h2>
        {detail && <p className="muted small">{detail}</p>}
        {error && <p className="error">{error}</p>}
        <div className="row-actions">
          <button type="button" className="danger" disabled={busy} onClick={go}>
            {busy ? busyLabel : confirmLabel}
          </button>
          <button
            type="button" className="link" disabled={busy}
            onClick={() => ref.current?.close()}
          >
            Keep it
          </button>
        </div>
      </dialog>
    </>
  )
}
