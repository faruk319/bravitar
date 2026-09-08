import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../../lib/api'

/** Which fingerprint/face reader id is this member. Templates stay on the device. */
export default function ReadersCard({ student, canManage }) {
  const [enrolments, setEnrolments] = useState(null)
  const [form, setForm] = useState({ device: '', external_id: '' })
  const [adding, setAdding] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetchAll(`/attendance/checkins/enrolments/?student=${student.id}`)
      .then((data) => !cancelled && setEnrolments(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [student.id, refresh])

  async function add(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/attendance/checkins/enrolments/', {
        method: 'POST',
        body: JSON.stringify({ ...form, student: student.id }),
      })
      setForm({ device: '', external_id: '' })
      setAdding(false)
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function remove(enrolment) {
    setError(null)
    try {
      await apiFetch(`/attendance/checkins/enrolments/${enrolment.id}/`, {
        method: 'DELETE',
      })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  // Nothing to say until a reader is actually in use.
  if (!canManage && !enrolments?.length) return null

  return (
    <div className="card wide">
      <div className="row">
        <h2>Fingerprint &amp; face readers</h2>
        {canManage && !adding && (
          <button type="button" className="link" onClick={() => setAdding(true)}>
            + Link a reader
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {enrolments === null ? (
        <p className="muted">Loading…</p>
      ) : enrolments.length === 0 ? (
        <p className="muted">Not enrolled on any reader.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Reader</th><th>Its user number</th><th>Linked</th>{canManage && <th />}</tr>
          </thead>
          <tbody>
            {enrolments.map((row) => (
              <tr key={row.id}>
                <td>{row.device}</td>
                <td>#{row.external_id}</td>
                <td>{row.created_at?.slice(0, 10)}</td>
                {canManage && (
                  <td>
                    <button type="button" className="link" onClick={() => remove(row)}>
                      Unlink
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canManage && adding && (
        <form className="set-entry" onSubmit={add}>
          <label>Reader
            <input required value={form.device} placeholder="front-door"
                   onChange={(e) => setForm({ ...form, device: e.target.value })} />
          </label>
          <label>Its user number
            <input required value={form.external_id} placeholder="47"
                   onChange={(e) => setForm({ ...form, external_id: e.target.value })} />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Link'}</button>
          <button type="button" className="link" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}

      {canManage && (
        <p className="muted small">
          Enrol the finger or face on the reader itself, then link the number it
          gave them here. No fingerprint or face data is stored by Bravitar —
          the reader matches locally and only tells us who it matched.
        </p>
      )}
    </div>
  )
}
