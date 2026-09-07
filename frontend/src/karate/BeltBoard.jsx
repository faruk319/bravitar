import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'

export default function BeltBoard() {
  const [standings, setStandings] = useState(null)
  const [gradings, setGradings] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([apiFetch('/karate/standings/'), apiFetch('/karate/gradings/')])
      .then(([s, g]) => {
        setStandings(s.students)
        setGradings(g)
      })
      .catch((err) => setError(err.message))
  }, [])

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

      <div className="card wide">
        <h2>Gradings held</h2>
        <table className="data-table">
          <thead><tr><th>Date</th><th>Belt</th><th>Examiner</th><th>Passed</th><th>Candidates</th></tr></thead>
          <tbody>
            {gradings.map((g) => (
              <tr key={g.id}>
                <td>{g.held_on}</td>
                <td>{g.belt_name}</td>
                <td>{g.examiner || '—'}</td>
                <td>{g.passed_count}</td>
                <td>{g.results.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
