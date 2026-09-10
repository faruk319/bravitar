import { useState } from 'react'

import ConfirmAction from '../../components/ConfirmAction'
import InfoDot from '../../components/InfoDot'
import { apiFetch } from '../../lib/api'

/**
 * Whether this member can sign in and see their own record.
 *
 * Off until somebody turns it on: the email here is a contact detail the desk
 * typed in, so it grants nothing on its own.
 */

export default function LoginCard({ student, canManage, onChanged }) {
  const [state, setState] = useState({
    invited: student.invited_at != null,
    signed_in: Boolean(student.user_id),
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function set(allowed) {
    setBusy(true)
    setError(null)
    try {
      setState(await apiFetch(`/students/${student.id}/invite/`, {
        method: 'POST',
        body: JSON.stringify(allowed ? {} : { allowed: false }),
      }))
      onChanged?.()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  return (
    <div className="card wide">
      <div className="row">
        <h2>
          Member login{' '}
          <InfoDot>
            They see their own plan, classes, attendance and fees, and can book
            their own place. They never see anybody else&apos;s.
          </InfoDot>
        </h2>
        {state.invited
          ? <span className={state.signed_in ? 'pill active' : 'pill pending'}>
              {state.signed_in ? 'signed in' : 'invited'}
            </span>
          : <span className="muted small">off</span>}
      </div>

      {error && <p className="error">{error}</p>}

      {!student.email && !state.invited && (
        <p className="muted small">Add an email address first.</p>
      )}

      {canManage && (
        <div className="row-actions">
          {state.invited ? (
            <ConfirmAction
              label="Turn login off"
              heading={`Stop ${student.full_name} signing in?`}
              detail="They lose access to the app. Their record, plan, attendance and fees all stay exactly as they are."
              confirmLabel="Yes, turn it off"
              onConfirm={() => set(false)}
            />
          ) : (
            <button type="button" disabled={busy || !student.email}
                    onClick={() => set(true)}>
              {busy ? 'Saving…' : 'Let them sign in'}
            </button>
          )}
          {state.invited && !state.signed_in && (
            <span className="muted small">
              They sign in at this address with {student.email}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
