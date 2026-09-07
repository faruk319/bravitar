import { useEffect, useState } from 'react'

import { apiFetchAll } from '../lib/api'
import { useBranches } from './useBranches'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function Batches() {
  const branches = useBranches()
  const [batches, setBatches] = useState(null)
  const [branch, setBranch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [enrolments, setEnrolments] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const params = branch ? `?branch=${branch}` : ''
    apiFetchAll(`/batches/${params}`)
      .then((data) => !cancelled && setBatches(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [branch])

  function toggle(batch) {
    if (expanded === batch.id) {
      setExpanded(null)
      return
    }
    setExpanded(batch.id)
    setEnrolments([])
    apiFetchAll(`/batches/enrolments/?batch=${batch.id}`)
      .then(setEnrolments)
      .catch((err) => setError(err.message))
  }

  if (error) return <p className="error">{error}</p>

  return (
    <>
      <h1>Batches &amp; Schedule</h1>
      <p className="muted">Classes and training groups, across every branch.</p>

      <div className="filters">
        <select value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {batches === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="stack wide">
          {batches.map((batch) => {
            const full = batch.capacity && batch.enrolled_count >= batch.capacity
            return (
              <div className="card wide" key={batch.id}>
                <div className="row">
                  <div>
                    <strong>{batch.name}</strong>
                    <div className="muted small">
                      {batch.branch_name} · {batch.coach_name || 'No coach set'} ·{' '}
                      {(batch.days_of_week ?? []).map((d) => DAYS[d]).join(', ') || 'No days set'}
                      {batch.start_time && ` · ${batch.start_time.slice(0, 5)}–${batch.end_time?.slice(0, 5)}`}
                    </div>
                  </div>
                  <div className="row-actions">
                    <span className={full ? 'pill left' : 'pill active'}>
                      {batch.enrolled_count}/{batch.capacity ?? '∞'}{full ? ' full' : ''}
                    </span>
                    <button type="button" className="link" onClick={() => toggle(batch)}>
                      {expanded === batch.id ? 'Hide' : 'Members'}
                    </button>
                  </div>
                </div>

                {expanded === batch.id && (
                  <table className="data-table">
                    <thead><tr><th>Member</th><th>Enrolled</th><th>Status</th></tr></thead>
                    <tbody>
                      {enrolments.length === 0 ? (
                        <tr><td colSpan={3} className="muted">No one enrolled yet.</td></tr>
                      ) : enrolments.map((e) => (
                        <tr key={e.id}>
                          <td>{e.student_name}</td>
                          <td>{e.enrolled_on}</td>
                          <td>{e.is_active ? 'Active' : `Left ${e.left_on ?? ''}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
