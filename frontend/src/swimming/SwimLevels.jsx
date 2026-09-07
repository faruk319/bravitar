import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'

export default function SwimLevels() {
  const [data, setData] = useState(null)
  const [levels, setLevels] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([apiFetch('/swimming/progress/'), apiFetch('/swimming/levels/')])
      .then(([progress, levelData]) => {
        setData(progress)
        setLevels(levelData)
      })
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>

  const swimmers = data.students.filter((s) => s.skills_achieved > 0)

  return (
    <>
      <h1>Skill Levels</h1>
      <p className="muted">
        A level counts as reached only once every skill in it is signed off.
      </p>

      <div className="card wide">
        <h2>The ladder</h2>
        <ol className="ladder">
          {levels.map((level) => (
            <li key={level.id}>
              <strong>{level.name}</strong>
              <span className="muted small"> · {level.skills.length} skills</span>
              <div className="muted small">{level.description}</div>
            </li>
          ))}
        </ol>
      </div>

      <div className="card wide">
        <h2>Swimmers</h2>
        <p className="muted small">{swimmers.length} with recorded progress</p>
        <table className="data-table">
          <thead>
            <tr>
              <th>Swimmer</th>
              <th>Current level</th>
              {data.levels.map((l) => (
                <th key={l.id}>{l.name.split(' — ')[0].replace('Level ', 'L')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {swimmers.map((s) => (
              <tr key={s.student}>
                <td>{s.student_name}</td>
                <td>{s.current_level ? s.current_level.split(' — ')[1] ?? s.current_level : '—'}</td>
                {s.levels.map((l) => (
                  <td key={l.level}>
                    <span className={l.complete ? 'level-cell done' : l.achieved ? 'level-cell part' : 'level-cell'}>
                      {l.achieved}/{l.total}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
