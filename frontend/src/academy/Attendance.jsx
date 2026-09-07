import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../lib/api'

const STATUSES = ['present', 'absent', 'late', 'excused']
const today = () => new Date().toISOString().slice(0, 10)

export default function Attendance() {
  const [batches, setBatches] = useState([])
  const [batchId, setBatchId] = useState('')
  const [date, setDate] = useState(today)
  const [roster, setRoster] = useState([])
  const [marks, setMarks] = useState({})
  const [summary, setSummary] = useState([])
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetchAll('/batches/?active=true')
      .then((data) => {
        setBatches(data)
        if (data.length) setBatchId(String(data[0].id))
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    if (!batchId) return
    let cancelled = false

    Promise.all([
      apiFetchAll(`/batches/enrolments/?batch=${batchId}`),
      apiFetchAll(`/attendance/?batch=${batchId}&date=${date}`),
      apiFetch(`/attendance/summary/?batch=${batchId}`),
    ])
      .then(([enrolments, existing, summaryData]) => {
        if (cancelled) return
        setSaved(false)
        setRoster(enrolments.filter((e) => e.is_active))
        setMarks(Object.fromEntries(existing.map((r) => [r.student, r.status])))
        setSummary(summaryData.students)
      })
      .catch((err) => !cancelled && setError(err.message))

    return () => {
      cancelled = true
    }
  }, [batchId, date])

  async function save() {
    setError(null)
    try {
      await apiFetch('/attendance/mark/', {
        method: 'POST',
        body: JSON.stringify({
          batch: Number(batchId),
          date,
          marks: roster.map((e) => ({
            student: e.student,
            status: marks[e.student] ?? 'present',
          })),
        }),
      })
      setSaved(true)
      setSummary((await apiFetch(`/attendance/summary/?batch=${batchId}`)).students)
    } catch (err) {
      setError(err.message)
    }
  }

  const rateFor = (studentId) => summary.find((s) => s.student === studentId)?.rate

  return (
    <>
      <h1>Attendance</h1>
      <p className="muted">Mark the register, and see who is actually turning up.</p>

      <div className="filters">
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="button" onClick={save} disabled={roster.length === 0}>Save register</button>
        {saved && <span className="muted small">Saved ✓</span>}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card wide">
        {roster.length === 0 ? (
          <p className="muted">No one enrolled in this batch.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Member</th><th>Status</th><th>Overall rate</th></tr>
            </thead>
            <tbody>
              {roster.map((e) => {
                const rate = rateFor(e.student)
                return (
                  <tr key={e.id}>
                    <td>{e.student_name}</td>
                    <td>
                      <div className="row-actions">
                        {STATUSES.map((s) => (
                          <label key={s} className="radio-inline">
                            <input
                              type="radio"
                              name={`mark-${e.student}`}
                              checked={(marks[e.student] ?? 'present') === s}
                              onChange={() => setMarks({ ...marks, [e.student]: s })}
                            />
                            {s}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>{rate === undefined || rate === null ? '—' : `${Math.round(rate * 100)}%`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
