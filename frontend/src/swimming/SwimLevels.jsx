import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../lib/api'
import StudentPicker from '../academy/StudentPicker'

function SignOffSkill({ levels, onDone, onCancel }) {
  const [student, setStudent] = useState(null)
  const [skillId, setSkillId] = useState('')
  const [achievedOn, setAchievedOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save(event) {
    event.preventDefault()
    if (!student || !skillId) {
      setError('Pick a swimmer and a skill.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/swimming/assessments/', {
        method: 'POST',
        body: JSON.stringify({
          student: student.id, skill: Number(skillId), achieved_on: achievedOn,
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
      <h2>Sign off a skill</h2>
      <p className="muted small">
        A level counts as reached only once every skill in it is signed off.
      </p>

      <label>Swimmer<StudentPicker value={student} onChange={setStudent} /></label>

      <div className="set-entry">
        <label>Skill
          <select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">Choose a skill…</option>
            {levels.map((level) => (
              <optgroup key={level.id} label={level.name}>
                {level.skills.map((skill) => (
                  <option key={skill.id} value={skill.id}>{skill.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>Achieved on
          <input type="date" required value={achievedOn}
                 onChange={(e) => setAchievedOn(e.target.value)} />
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Sign off'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function SwimLevels({ role }) {
  const [data, setData] = useState(null)
  const [levels, setLevels] = useState([])
  const [signing, setSigning] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  const canManage = ['owner', 'manager'].includes(role)

  useEffect(() => {
    let cancelled = false
    Promise.all([apiFetch('/swimming/progress/'), apiFetchAll('/swimming/levels/')])
      .then(([progress, levelData]) => {
        if (cancelled) return
        setData(progress)
        setLevels(levelData)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [refresh])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>

  const swimmers = data.students.filter((s) => s.skills_achieved > 0)

  return (
    <>
      <h1>Skill Levels</h1>
      <p className="muted">
        A level counts as reached only once every skill in it is signed off.
      </p>

      {canManage && (
        <div className="filters">
          <button type="button" onClick={() => setSigning(true)}>+ Sign off a skill</button>
        </div>
      )}

      {canManage && signing && (
        <SignOffSkill
          levels={levels}
          onCancel={() => setSigning(false)}
          onDone={() => {
            setSigning(false)
            setRefresh((n) => n + 1)
          }}
        />
      )}

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
