import { useEffect, useState } from 'react'

import ConfirmAction from '../../components/ConfirmAction'
import { apiFetch, apiFetchAll } from '../../lib/api'

/**
 * Which batches a member is in, and putting them in or taking them out.
 *
 * Leaving a batch marks the enrolment as left rather than deleting it, so the
 * attendance already taken against it still makes sense. Deleting is there for
 * the other case — somebody added to the wrong batch this morning.
 */
export default function BatchesCard({ student, canManage }) {
  const [enrolments, setEnrolments] = useState(null)
  const [batches, setBatches] = useState([])
  const [batchId, setBatchId] = useState('')
  const [adding, setAdding] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetchAll(`/batches/enrolments/?student=${student.id}`),
      apiFetchAll('/batches/'),
    ])
      .then(([e, b]) => {
        if (cancelled) return
        setEnrolments(e)
        setBatches(b)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [student.id, refresh])

  async function enrol(event) {
    event.preventDefault()
    if (!batchId) return
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/batches/enrolments/', {
        method: 'POST',
        body: JSON.stringify({
          batch: Number(batchId),
          student: student.id,
          enrolled_on: new Date().toISOString().slice(0, 10),
          is_active: true,
        }),
      })
      setBatchId('')
      setAdding(false)
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function leave(enrolment) {
    setError(null)
    try {
      await apiFetch(`/batches/enrolments/${enrolment.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          is_active: false,
          left_on: new Date().toISOString().slice(0, 10),
        }),
      })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(enrolment) {
    await apiFetch(`/batches/enrolments/${enrolment.id}/`, { method: 'DELETE' })
    setRefresh((n) => n + 1)
  }

  // A batch they are already actively in should not be offerable again.
  const enrolled = new Set(
    (enrolments ?? []).filter((e) => e.is_active).map((e) => e.batch),
  )
  const available = batches.filter((b) => !enrolled.has(b.id))

  return (
    <div className="card wide">
      <div className="row">
        <h2>Batches</h2>
        {canManage && !adding && available.length > 0 && (
          <button type="button" className="link" onClick={() => setAdding(true)}>
            + Add to a batch
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {canManage && adding && (
        <form className="set-entry" onSubmit={enrol}>
          <label>Batch
            <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">Choose a batch…</option>
              {available.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={!batchId || busy}>
            {busy ? 'Saving…' : 'Add'}
          </button>
          <button type="button" className="link" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}

      {enrolments === null ? (
        <p className="muted">Loading…</p>
      ) : enrolments.length === 0 ? (
        <p className="muted">Not in any batch yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Batch</th><th>Enrolled</th><th>Status</th>{canManage && <th />}</tr>
          </thead>
          <tbody>
            {enrolments.map((e) => (
              <tr key={e.id}>
                <td>{e.batch_name}</td>
                <td>{e.enrolled_on}</td>
                <td>
                  {e.is_active
                    ? <span className="pill active">in</span>
                    : <span className="pill left">left {e.left_on ?? ''}</span>}
                </td>
                {canManage && (
                  <td>
                    <div className="row-actions">
                      {e.is_active && (
                        <button type="button" className="link" onClick={() => leave(e)}>
                          Take out
                        </button>
                      )}
                      <ConfirmAction
                        label="Delete"
                        heading={`Delete this ${e.batch_name} enrolment?`}
                        detail={"The record goes, and past attendance marked against it stops making sense. "
                          + "If they simply stopped coming, use Take out instead."}
                        confirmLabel="Yes, delete it"
                        onConfirm={() => remove(e)}
                      />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canManage && enrolments?.some((e) => !e.is_active) && (
        <p className="muted small">
          &ldquo;Take out&rdquo; keeps the record so past attendance still reads
          correctly. Delete only removes an enrolment made by mistake.
        </p>
      )}
    </div>
  )
}
