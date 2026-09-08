import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../../lib/api'
import ConfirmAction from '../../components/ConfirmAction'
import InfoDot from '../../components/InfoDot'

/**
 * Who trains this member, and on what cut.
 *
 * Only offered on a plan that includes personal training — the backend
 * refuses otherwise, and there is no point showing a form that cannot save.
 */

const today = () => new Date().toISOString().slice(0, 10)

export default function TrainerCard({ student, canManage }) {
  const [assignments, setAssignments] = useState(null)
  const [team, setTeam] = useState([])
  const [assigning, setAssigning] = useState(false)
  const [trainerId, setTrainerId] = useState('')
  const [commission, setCommission] = useState('0')
  const [startedOn, setStartedOn] = useState(today)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetchAll(`/gym-ops/trainers/?student=${student.id}`),
      apiFetchAll('/organizations/current/team/').catch(() => []),
    ])
      .then(([rows, people]) => {
        if (cancelled) return
        setAssignments(rows)
        setTeam(people.filter((p) => p.role !== 'member'))
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [student.id, refresh])

  async function assign(event) {
    event.preventDefault()
    if (!trainerId) return
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/gym-ops/trainers/', {
        method: 'POST',
        body: JSON.stringify({
          student: student.id,
          trainer: Number(trainerId),
          started_on: startedOn,
          commission_percent: commission || '0',
        }),
      })
      setAssigning(false)
      setTrainerId('')
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function end(assignment) {
    await apiFetch(`/gym-ops/trainers/${assignment.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ ended_on: today() }),
    })
    setRefresh((n) => n + 1)
  }

  const running = (assignments ?? []).find((a) => a.is_running)

  return (
    <div className="card wide">
      <div className="row">
        <h2>
          Personal trainer{' '}
          <InfoDot>
            Offered only on a plan that includes one. Commission is counted on
            what this member actually pays, not on what they are billed.
          </InfoDot>
        </h2>
        {canManage && !assigning && !running && (
          <button type="button" className="link" onClick={() => setAssigning(true)}>
            + Assign a trainer
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {canManage && assigning && (
        <form className="set-entry" onSubmit={assign}>
          <label>Trainer
            <select value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
              <option value="">Choose…</option>
              {team.map((p) => (
                <option key={p.id} value={p.id}>{p.email} — {p.role}</option>
              ))}
            </select>
          </label>
          <label>Commission %
            <input type="number" min="0" max="100" step="0.5" value={commission}
                   onChange={(e) => setCommission(e.target.value)} />
          </label>
          <label>From
            <input type="date" value={startedOn}
                   onChange={(e) => setStartedOn(e.target.value)} />
          </label>
          <button type="submit" disabled={!trainerId || busy}>
            {busy ? 'Saving…' : 'Assign'}
          </button>
          <button type="button" className="link" onClick={() => setAssigning(false)}>
            Cancel
          </button>
        </form>
      )}

      {assignments === null ? (
        <p className="muted">Loading…</p>
      ) : assignments.length === 0 ? (
        <p className="muted small">No trainer assigned.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Trainer</th><th>From</th><th>To</th><th>Cut</th>{canManage && <th />}</tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td>{a.trainer_email}</td>
                <td>{a.started_on}</td>
                <td>{a.ended_on ?? <span className="pill active">running</span>}</td>
                <td>{Number(a.commission_percent)}%</td>
                {canManage && (
                  <td>
                    {a.is_running && (
                      <ConfirmAction
                        label="End"
                        heading={`End ${a.trainer_email}'s assignment?`}
                        detail={'They stop earning on this member from today. '
                          + 'What they have already earned stays counted.'}
                        confirmLabel="Yes, end it"
                        onConfirm={() => end(a)}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
