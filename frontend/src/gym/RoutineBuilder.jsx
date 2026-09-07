import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'

const emptyItem = (exercise) => ({
  exercise,
  target_sets: 3,
  target_reps: 10,
  target_weight: '',
  rest_seconds: '',
})

function RoutineForm({ onSaved, onCancel }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!search) return
    const timer = setTimeout(() => {
      apiFetch(`/gym/exercises/?search=${encodeURIComponent(search)}`)
        .then((data) => setResults(data.slice(0, 8)))
        .catch((err) => setError(err.message))
    }, 200)
    return () => clearTimeout(timer)
  }, [search])

  function addExercise(exercise) {
    if (!items.some((item) => item.exercise.id === exercise.id)) {
      setItems((current) => [...current, emptyItem(exercise)])
    }
    setSearch('')
    setResults([])
  }

  function updateItem(index, field, value) {
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    )
  }

  function move(index, delta) {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    setItems((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (items.length === 0) {
      setError('Add at least one exercise.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/gym/routines/', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          items: items.map((item) => ({
            exercise_id: item.exercise.id,
            target_sets: Number(item.target_sets),
            target_reps: Number(item.target_reps),
            target_weight: item.target_weight === '' ? null : item.target_weight,
            rest_seconds: item.rest_seconds === '' ? null : Number(item.rest_seconds),
          })),
        }),
      })
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card wide" onSubmit={handleSubmit}>
      <h2>New routine</h2>

      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label>
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <label>
        Add exercises
        <input
          type="search"
          value={search}
          placeholder="Search the library…"
          onChange={(e) => {
            setSearch(e.target.value)
            if (!e.target.value) setResults([])
          }}
        />
      </label>

      {results.length > 0 && (
        <ul className="search-results">
          {results.map((exercise) => (
            <li key={exercise.id}>
              <button type="button" className="link" onClick={() => addExercise(exercise)}>
                + {exercise.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <table className="routine-table">
          <thead>
            <tr>
              <th>Exercise</th>
              <th>Sets</th>
              <th>Reps</th>
              <th>Weight</th>
              <th>Rest (s)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.exercise.id}>
                <td>{item.exercise.name}</td>
                <td>
                  <input
                    type="number"
                    min="1"
                    value={item.target_sets}
                    onChange={(e) => updateItem(index, 'target_sets', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="1"
                    value={item.target_reps}
                    onChange={(e) => updateItem(index, 'target_reps', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={item.target_weight}
                    onChange={(e) => updateItem(index, 'target_weight', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    value={item.rest_seconds}
                    onChange={(e) => updateItem(index, 'rest_seconds', e.target.value)}
                  />
                </td>
                <td className="row-actions">
                  <button type="button" className="link" onClick={() => move(index, -1)}>↑</button>
                  <button type="button" className="link" onClick={() => move(index, 1)}>↓</button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => setItems(items.filter((_, i) => i !== index))}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save routine'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function RoutineBuilder() {
  const [routines, setRoutines] = useState(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  function load() {
    apiFetch('/gym/routines/').then(setRoutines).catch((err) => setError(err.message))
  }

  useEffect(load, [])

  if (error) return <p className="error">{error}</p>

  if (creating) {
    return (
      <RoutineForm
        onCancel={() => setCreating(false)}
        onSaved={() => {
          setCreating(false)
          load()
        }}
      />
    )
  }

  return (
    <>
      <h1>Workout Routines</h1>
      <p className="muted">Your routines in this academy.</p>

      <button type="button" onClick={() => setCreating(true)}>+ New routine</button>

      {routines === null ? (
        <p className="muted">Loading…</p>
      ) : routines.length === 0 ? (
        <p className="muted">No routines yet.</p>
      ) : (
        <ul className="routine-list">
          {routines.map((routine) => (
            <li key={routine.id}>
              <strong>{routine.name}</strong>
              {routine.description && <span className="muted small">{routine.description}</span>}
              <ol className="muted small">
                {routine.items.map((item) => (
                  <li key={item.id}>
                    {item.exercise.name} — {item.target_sets}×{item.target_reps}
                    {item.target_weight && ` @ ${item.target_weight}`}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
