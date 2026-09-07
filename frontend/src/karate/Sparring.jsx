import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'

export default function Sparring() {
  const [bouts, setBouts] = useState(null)
  const [standings, setStandings] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([apiFetch('/karate/bouts/'), apiFetch('/karate/standings/')])
      .then(([b, s]) => {
        setBouts(b)
        setStandings(s.students.filter((x) => x.bouts > 0))
      })
      .catch((err) => setError(err.message))
  }, [])

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
