import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../lib/api'
import StudentPicker from '../academy/StudentPicker'

function NewGrading({ belts, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({
    belt: '', held_on: new Date().toISOString().slice(0, 10), examiner: '',
  }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/karate/gradings/', {
        method: 'POST',
        body: JSON.stringify({ ...form, belt: Number(form.belt) }),
      })
      onDone()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card wide" onSubmit={save}>
      <h2>Hold a grading</h2>
      <div className="set-entry">
        <label>Testing for
          <select required value={form.belt}
                  onChange={(e) => setForm({ ...form, belt: e.target.value })}>
            <option value="">Choose a belt…</option>
            {belts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label>Held on
          <input type="date" required value={form.held_on}
                 onChange={(e) => setForm({ ...form, held_on: e.target.value })} />
        </label>
        <label>Examiner
          <input value={form.examiner}
                 onChange={(e) => setForm({ ...form, examiner: e.target.value })} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create grading'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function GradingResults({ grading, onChanged }) {
  const [student, setStudent] = useState(null)
  const [result, setResult] = useState('pass')
  const [error, setError] = useState(null)

  async function record(event) {
    event.preventDefault()
    if (!student) return
    setError(null)
    try {
      await apiFetch('/karate/results/', {
        method: 'POST',
        body: JSON.stringify({ grading: grading.id, student: student.id, result }),
      })
      setStudent(null)
      onChanged()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <form className="set-entry" onSubmit={record}>
        <label>Candidate<StudentPicker value={student} onChange={setStudent} /></label>
        <label>Result
          <select value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="absent">Absent</option>
          </select>
        </label>
        <button type="submit" disabled={!student}>Record</button>
      </form>
      {error && <p className="error">{error}</p>}
      {grading.results.length > 0 && (
        <table className="data-table">
          <thead><tr><th>Candidate</th><th>Result</th></tr></thead>
          <tbody>
            {grading.results.map((r) => (
              <tr key={r.id}>
                <td>{r.student_name}</td>
                <td><span className={`pill ${r.result === 'pass' ? 'active' : 'left'}`}>{r.result}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

export default function BeltBoard({ role }) {
  const [standings, setStandings] = useState(null)
  const [gradings, setGradings] = useState([])
  const [belts, setBelts] = useState([])
  const [creating, setCreating] = useState(false)
  const [openGrading, setOpenGrading] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  const canManage = ['owner', 'manager'].includes(role)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('/karate/standings/'),
      apiFetchAll('/karate/gradings/'),
      apiFetchAll('/karate/belts/'),
    ])
      .then(([s, g, b]) => {
        if (cancelled) return
        setStandings(s.students)
        setGradings(g)
        setBelts(b)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [refresh])

  if (error) return <p className="error">{error}</p>
  if (!standings) return <p className="muted">Loading…</p>

  const graded = standings.filter((s) => s.belt)

  return (
    <>
      <h1>Belts &amp; Gradings</h1>
      <p className="muted">
        A student's belt is their highest passed grading — correct a result and
        the belt corrects itself.
      </p>

      {canManage && (
        <div className="filters">
          <button type="button" onClick={() => setCreating(true)}>+ Hold a grading</button>
        </div>
      )}

      {canManage && creating && (
        <NewGrading
          belts={belts}
          onCancel={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            setRefresh((n) => n + 1)
          }}
        />
      )}

      <div className="card wide">
        <h2>Gradings held</h2>
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>Belt</th><th>Examiner</th><th>Passed</th><th>Candidates</th>{canManage && <th />}</tr>
          </thead>
          <tbody>
            {gradings.map((g) => (
              <tr key={g.id}>
                <td>{g.held_on}</td>
                <td>{g.belt_name}</td>
                <td>{g.examiner || '—'}</td>
                <td>{g.passed_count}</td>
                <td>{g.results.length}</td>
                {canManage && (
                  <td>
                    <button type="button" className="link"
                            onClick={() => setOpenGrading(openGrading === g.id ? null : g.id)}>
                      {openGrading === g.id ? 'Close' : 'Results'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && openGrading && (
        <div className="card wide">
          <h2>
            {gradings.find((g) => g.id === openGrading)?.belt_name} grading —{' '}
            {gradings.find((g) => g.id === openGrading)?.held_on}
          </h2>
          <p className="muted small">
            A pass here becomes that student's belt — it is derived, never stored.
          </p>
          <GradingResults
            grading={gradings.find((g) => g.id === openGrading)}
            onChanged={() => setRefresh((n) => n + 1)}
          />
        </div>
      )}

      <div className="card wide">
        <h2>Current belts</h2>
        <p className="muted small">{graded.length} graded students</p>
        <table className="data-table">
          <thead><tr><th>Student</th><th>Belt</th><th>Record</th><th>Win rate</th></tr></thead>
          <tbody>
            {graded.map((s) => (
              <tr key={s.student}>
                <td>{s.student_name}</td>
                <td>
                  <span className="belt-chip" style={{ background: s.belt_colour || '#ccc' }} />
                  {s.belt}
                </td>
                <td>{s.wins}W · {s.losses}L · {s.draws}D</td>
                <td>{s.win_rate === null ? '—' : `${Math.round(s.win_rate * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
