import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../lib/api'
import StudentPicker from './StudentPicker'
import { useBranches } from './useBranches'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const blankBatch = () => ({
  name: '', description: '', coach_name: '', branch: '',
  days_of_week: [], start_time: '', end_time: '', capacity: '',
})

function BatchForm({ batch, branches, onSaved, onCancel }) {
  const [form, setForm] = useState(() =>
    batch
      ? {
          name: batch.name, description: batch.description ?? '',
          coach_name: batch.coach_name ?? '', branch: batch.branch ?? '',
          days_of_week: batch.days_of_week ?? [],
          start_time: batch.start_time?.slice(0, 5) ?? '',
          end_time: batch.end_time?.slice(0, 5) ?? '',
          capacity: batch.capacity ?? '',
        }
      : blankBatch(),
  )
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  function toggleDay(index) {
    setForm((f) => ({
      ...f,
      days_of_week: f.days_of_week.includes(index)
        ? f.days_of_week.filter((d) => d !== index)
        : [...f.days_of_week, index].sort((a, b) => a - b),
    }))
  }

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch(batch ? `/batches/${batch.id}/` : '/batches/', {
        method: batch ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...form,
          branch: form.branch === '' ? null : Number(form.branch),
          start_time: form.start_time || null,
          end_time: form.end_time || null,
          capacity: form.capacity === '' ? null : Number(form.capacity),
        }),
      })
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card wide" onSubmit={save}>
      <h2>{batch ? `Edit ${batch.name}` : 'New batch'}</h2>

      <div className="two-up">
        <label>
          Name
          <input required value={form.name}
                 onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Coach
          <input value={form.coach_name}
                 onChange={(e) => setForm({ ...form, coach_name: e.target.value })} />
        </label>
      </div>

      <label>
        Description
        <input value={form.description}
               onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>

      <fieldset>
        <legend>Runs on</legend>
        <div className="day-picker">
          {DAYS.map((day, index) => (
            <label key={day} className="checkbox">
              <input type="checkbox" checked={form.days_of_week.includes(index)}
                     onChange={() => toggleDay(index)} />
              {day}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="set-entry">
        <label>
          Starts
          <input type="time" value={form.start_time}
                 onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
        </label>
        <label>
          Ends
          <input type="time" value={form.end_time}
                 onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
        </label>
        <label>
          Capacity
          <input type="number" min="1" placeholder="no limit" value={form.capacity}
                 onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
        </label>
        <label>
          Branch
          <select value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}>
            <option value="">No branch</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save batch'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function Roster({ batch, canManage, onChanged }) {
  const [enrolments, setEnrolments] = useState(null)
  const [student, setStudent] = useState(null)
  const [error, setError] = useState(null)

  function load() {
    apiFetchAll(`/batches/enrolments/?batch=${batch.id}`)
      .then(setEnrolments)
      .catch((err) => setError(err.message))
  }

  useEffect(load, [batch.id])

  async function enrol(event) {
    event.preventDefault()
    if (!student) return
    setError(null)
    try {
      await apiFetch('/batches/enrolments/', {
        method: 'POST',
        body: JSON.stringify({
          batch: batch.id,
          student: student.id,
          enrolled_on: new Date().toISOString().slice(0, 10),
        }),
      })
      setStudent(null)
      load()
      onChanged()
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(enrolment) {
    setError(null)
    try {
      await apiFetch(`/batches/enrolments/${enrolment.id}/`, { method: 'DELETE' })
      load()
      onChanged()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      {canManage && (
        <form className="set-entry" onSubmit={enrol}>
          <label>
            Enrol a member
            <StudentPicker value={student} onChange={setStudent} />
          </label>
          <button type="submit" disabled={!student}>Enrol</button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      <table className="data-table">
        <thead><tr><th>Member</th><th>Enrolled</th><th>Status</th>{canManage && <th />}</tr></thead>
        <tbody>
          {enrolments === null ? (
            <tr><td colSpan={4} className="muted">Loading…</td></tr>
          ) : enrolments.length === 0 ? (
            <tr><td colSpan={4} className="muted">No one enrolled yet.</td></tr>
          ) : enrolments.map((e) => (
            <tr key={e.id}>
              <td>{e.student_name}</td>
              <td>{e.enrolled_on}</td>
              <td>{e.is_active ? 'Active' : `Left ${e.left_on ?? ''}`}</td>
              {canManage && (
                <td>
                  <button type="button" className="link" onClick={() => remove(e)}>Remove</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export default function Batches({ role }) {
  const branches = useBranches()
  const [batches, setBatches] = useState(null)
  const [branch, setBranch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [editing, setEditing] = useState(null)   // batch object, or 'new'
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  const canManage = ['owner', 'manager', 'staff'].includes(role)

  useEffect(() => {
    let cancelled = false
    apiFetchAll(`/batches/${branch ? `?branch=${branch}` : ''}`)
      .then((data) => !cancelled && setBatches(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [branch, refresh])

  const reload = () => setRefresh((n) => n + 1)

  if (error) return <p className="error">{error}</p>

  if (editing) {
    return (
      <BatchForm
        batch={editing === 'new' ? null : editing}
        branches={branches}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          reload()
        }}
      />
    )
  }

  return (
    <>
      <h1>Batches &amp; Schedule</h1>
      <p className="muted">Classes and training groups, across every branch.</p>

      <div className="filters">
        <select value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {canManage && (
          <button type="button" onClick={() => setEditing('new')}>+ New batch</button>
        )}
      </div>

      {batches === null ? (
        <p className="muted">Loading…</p>
      ) : batches.length === 0 ? (
        <p className="muted">
          No batches yet{canManage ? ' — create one to start taking attendance.' : '.'}
        </p>
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
                      {batch.branch_name ?? 'No branch'} · {batch.coach_name || 'No coach set'} ·{' '}
                      {(batch.days_of_week ?? []).map((d) => DAYS[d]).join(', ') || 'No days set'}
                      {batch.start_time && ` · ${batch.start_time.slice(0, 5)}–${batch.end_time?.slice(0, 5)}`}
                    </div>
                  </div>
                  <div className="row-actions">
                    <span className={full ? 'pill left' : 'pill active'}>
                      {batch.enrolled_count}/{batch.capacity ?? '∞'}{full ? ' full' : ''}
                    </span>
                    {canManage && (
                      <button type="button" className="link" onClick={() => setEditing(batch)}>
                        Edit
                      </button>
                    )}
                    <button
                      type="button" className="link"
                      onClick={() => setExpanded(expanded === batch.id ? null : batch.id)}
                    >
                      {expanded === batch.id ? 'Hide' : 'Members'}
                    </button>
                  </div>
                </div>

                {expanded === batch.id && (
                  <Roster batch={batch} canManage={canManage} onChanged={reload} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
