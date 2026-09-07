import { useEffect, useMemo, useState } from 'react'

import { apiFetch } from '../lib/api'

export default function ExerciseLibrary() {
  const [exercises, setExercises] = useState(null)
  const [meta, setMeta] = useState(null)
  const [search, setSearch] = useState('')
  const [muscle, setMuscle] = useState('')
  const [equipment, setEquipment] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch('/gym/exercises/meta/').then(setMeta).catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (muscle) params.set('muscle', muscle)
    if (equipment) params.set('equipment', equipment)

    const timer = setTimeout(() => {
      apiFetch(`/gym/exercises/?${params}`)
        .then(setExercises)
        .catch((err) => setError(err.message))
    }, 200)
    return () => clearTimeout(timer)
  }, [search, muscle, equipment])

  const labelFor = useMemo(() => {
    const lookup = {}
    for (const group of ['muscles', 'equipment', 'categories']) {
      for (const option of meta?.[group] ?? []) lookup[option.value] = option.label
    }
    return (value) => lookup[value] ?? value
  }, [meta])

  if (error) return <p className="error">{error}</p>

  return (
    <>
      <h1>Exercise Library</h1>
      <p className="muted">
        The shared library plus any exercises your academy has added.
      </p>

      <div className="filters">
        <input
          type="search"
          placeholder="Search exercises…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={muscle} onChange={(e) => setMuscle(e.target.value)}>
          <option value="">All muscles</option>
          {meta?.muscles.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select value={equipment} onChange={(e) => setEquipment(e.target.value)}>
          <option value="">All equipment</option>
          {meta?.equipment.map((e) => (
            <option key={e.value} value={e.value}>{e.label}</option>
          ))}
        </select>
      </div>

      {exercises === null ? (
        <p className="muted">Loading…</p>
      ) : exercises.length === 0 ? (
        <p className="muted">No exercises match those filters.</p>
      ) : (
        <>
          <p className="muted small">{exercises.length} exercises</p>
          <ul className="exercise-list">
            {exercises.map((exercise) => (
              <li key={exercise.id}>
                <div>
                  <strong>{exercise.name}</strong>
                  {exercise.is_custom && <span className="badge">custom</span>}
                </div>
                <span className="muted small">
                  {labelFor(exercise.primary_muscle)} · {labelFor(exercise.equipment)}
                  {exercise.secondary_muscles.length > 0 &&
                    ` · also ${exercise.secondary_muscles.map(labelFor).join(', ')}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
