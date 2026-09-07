import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'
import RestTimer from './RestTimer'

function ExercisePanel({ item, sessionId, onLogged }) {
  const [weight, setWeight] = useState(item.suggested.weight ?? '')
  const [reps, setReps] = useState(item.suggested.reps ?? '')
  const [rir, setRir] = useState('')
  const [isWarmup, setIsWarmup] = useState(false)
  const [logged, setLogged] = useState([])
  const [restStartedAt, setRestStartedAt] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const workingSets = logged.filter((s) => !s.is_warmup).length

  async function logSet() {
    setBusy(true)
    setError(null)
    try {
      const set = await apiFetch(`/gym/sessions/${sessionId}/sets/`, {
        method: 'POST',
        body: JSON.stringify({
          exercise_id: item.exercise.id,
          set_number: logged.length + 1,
          reps: Number(reps),
          weight: weight === '' ? null : String(weight),
          is_warmup: isWarmup,
          rir: rir === '' ? null : Number(rir),
        }),
      })
      setLogged((current) => [...current, set])
      setIsWarmup(false)
      if (item.rest_seconds) setRestStartedAt(Date.now())
      onLogged?.(set)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  return (
    <div className="card wide">
      <div className="row">
        <div>
          <h2>{item.exercise.name}</h2>
          <span className="muted small">
            {workingSets} / {item.target_sets} working sets
            {item.superset_group != null && ` · superset ${item.superset_group}`}
          </span>
        </div>
        {item.rest_seconds && (
          <RestTimer
            seconds={item.rest_seconds}
            startedAt={restStartedAt}
            onDone={() => setRestStartedAt(null)}
          />
        )}
      </div>

      <p className="muted small suggestion">
        Suggested: <strong>{item.suggested.weight ?? 'bodyweight'} × {item.suggested.reps}</strong>
        {' — '}{item.suggested.reason}
        {item.best_estimated_1rm && ` (best e1RM ${item.best_estimated_1rm})`}
      </p>

      {item.last_session.length > 0 && (
        <p className="muted small">
          Last time: {item.last_session.map((s) => `${s.reps}×${s.weight ?? 'BW'}`).join(', ')}
        </p>
      )}

      <div className="set-entry">
        <label>
          Weight
          <input type="number" step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </label>
        <label>
          Reps
          <input type="number" min="1" value={reps} onChange={(e) => setReps(e.target.value)} />
        </label>
        <label>
          RIR
          <input type="number" min="0" max="10" value={rir} onChange={(e) => setRir(e.target.value)} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={isWarmup} onChange={(e) => setIsWarmup(e.target.checked)} />
          Warm-up
        </label>
        <button type="button" onClick={logSet} disabled={busy || !reps}>
          {busy ? 'Logging…' : 'Log set'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {logged.length > 0 && (
        <ul className="logged-sets">
          {logged.map((set, index) => (
            <li key={set.id}>
              <span className="muted small">#{index + 1}</span>
              {set.reps} × {set.weight ?? 'BW'}
              {set.is_warmup && <span className="tag">warm-up</span>}
              {set.rir !== null && <span className="muted small"> RIR {set.rir}</span>}
              {set.estimated_1rm && <span className="muted small"> e1RM {set.estimated_1rm}</span>}
              {set.is_personal_record && <span className="badge pr">PR</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function GuidedSession({ routineId, onFinish }) {
  const [guide, setGuide] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [prCount, setPrCount] = useState(0)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch(`/gym/routines/${routineId}/guide/`),
      apiFetch('/gym/sessions/', {
        method: 'POST',
        body: JSON.stringify({ routine: routineId }),
      }),
    ])
      .then(([guideData, session]) => {
        if (cancelled) return
        setGuide(guideData)
        setSessionId(session.id)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [routineId])

  async function finish() {
    await apiFetch(`/gym/sessions/${sessionId}/complete/`, { method: 'POST' })
    onFinish()
  }

  if (error) return <p className="error">{error}</p>
  if (!guide || !sessionId) return <p className="muted">Starting session…</p>

  return (
    <>
      <div className="row">
        <div>
          <h1>{guide.routine.name}</h1>
          <p className="muted small">
            Guided session · progression: {guide.progression.replace('_', ' ')}
            {prCount > 0 && ` · ${prCount} PR${prCount > 1 ? 's' : ''} today 🎉`}
          </p>
        </div>
        <button type="button" onClick={finish}>Finish workout</button>
      </div>

      <div className="stack wide">
        {guide.items.map((item) => (
          <ExercisePanel
            key={item.routine_exercise_id}
            item={item}
            sessionId={sessionId}
            onLogged={(set) => set.is_personal_record && setPrCount((c) => c + 1)}
          />
        ))}
      </div>
    </>
  )
}
