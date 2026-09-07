import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../lib/api'
import StudentPicker from '../academy/StudentPicker'

function RecordBout({ onDone, onCancel }) {
  const [student, setStudent] = useState(null)
  const [form, setForm] = useState(() => ({
    fought_on: new Date().toISOString().slice(0, 10),
    opponent_name: '', result: 'win', points_for: 0, points_against: 0, event: '',
  }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save(event) {
    event.preventDefault()
    if (!student) {
      setError('Pick the fighter.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/karate/bouts/', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          student: student.id,
          points_for: Number(form.points_for),
          points_against: Number(form.points_against),
        }),
      })
      onDone()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card wide" onSubmit={save}>
      <h2>Record a bout</h2>

      <label>Fighter<StudentPicker value={student} onChange={setStudent} /></label>

      <div className="set-entry">
        <label>Opponent
          <input value={form.opponent_name} placeholder="Visiting dojo"
                 onChange={(e) => setForm({ ...form, opponent_name: e.target.value })} />
        </label>
        <label>Result
          <select value={form.result}
                  onChange={(e) => setForm({ ...form, result: e.target.value })}>
            <option value="win">Win</option>
            <option value="loss">Loss</option>
            <option value="draw">Draw</option>
          </select>
        </label>
        <label>Points for
          <input type="number" min="0" value={form.points_for}
                 onChange={(e) => setForm({ ...form, points_for: e.target.value })} />
        </label>
        <label>Points against
          <input type="number" min="0" value={form.points_against}
                 onChange={(e) => setForm({ ...form, points_against: e.target.value })} />
        </label>
        <label>Date
          <input type="date" required value={form.fought_on}
                 onChange={(e) => setForm({ ...form, fought_on: e.target.value })} />
        </label>
        <label>Event
          <input value={form.event} placeholder="Club night"
                 onChange={(e) => setForm({ ...form, event: e.target.value })} />
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save bout'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function Sparring({ role }) {
  const [bouts, setBouts] = useState(null)
  const [standings, setStandings] = useState([])
  const [recording, setRecording] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  const canManage = ['owner', 'manager'].includes(role)

  useEffect(() => {
    Promise.all([apiFetchAll('/karate/bouts/'), apiFetch('/karate/standings/')])
      .then(([b, s]) => {
        setBouts(b)
        setStandings(s.students.filter((x) => x.bouts > 0))
      })
      .catch((err) => setError(err.message))
  }, [refresh])

  if (error) return <p className="error">{error}</p>
  if (!bouts) return <p className="muted">Loading…</p>

  const totals = bouts.reduce(
    (acc, b) => ({ ...acc, [b.result]: (acc[b.result] ?? 0) + 1 }),
    {},
  )

  return (
    <>
      <h1>Sparring Records</h1>
      <p className="muted">Every recorded bout, and how the dojo is doing.</p>

      {canManage && (
        <div className="filters">
          <button type="button" onClick={() => setRecording(true)}>+ Record a bout</button>
        </div>
      )}

      {canManage && recording && (
        <RecordBout
          onCancel={() => setRecording(false)}
          onDone={() => {
            setRecording(false)
            setRefresh((n) => n + 1)
          }}
        />
      )}

      <div className="stat-row">
        <div className="stat-tile">
          <span className="muted small">Bouts recorded</span>
          <div className="stat-value">{bouts.length}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Wins</span>
          <div className="stat-value">{totals.win ?? 0}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Losses</span>
          <div className="stat-value">{totals.loss ?? 0}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Draws</span>
          <div className="stat-value">{totals.draw ?? 0}</div>
        </div>
      </div>

      <div className="card wide">
        <h2>Fighters</h2>
        <table className="data-table">
          <thead><tr><th>Student</th><th>Belt</th><th>Bouts</th><th>Record</th><th>Win rate</th></tr></thead>
          <tbody>
            {standings.map((s) => (
              <tr key={s.student}>
                <td>{s.student_name}</td>
                <td>{s.belt ?? '—'}</td>
                <td>{s.bouts}</td>
                <td>{s.wins}W · {s.losses}L · {s.draws}D</td>
                <td>{s.win_rate === null ? '—' : `${Math.round(s.win_rate * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card wide">
        <h2>Recent bouts</h2>
        <table className="data-table">
          <thead><tr><th>Date</th><th>Student</th><th>Opponent</th><th>Result</th><th>Score</th><th>Event</th></tr></thead>
          <tbody>
            {bouts.slice(0, 30).map((b) => (
              <tr key={b.id}>
                <td>{b.fought_on}</td>
                <td>{b.student_name}</td>
                <td>{b.opponent_name || '—'}</td>
                <td><span className={`pill ${b.result}`}>{b.result}</span></td>
                <td>{b.points_for}–{b.points_against}</td>
                <td>{b.event || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
