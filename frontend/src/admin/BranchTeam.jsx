import { useEffect, useState } from 'react'

import ConfirmAction from '../components/ConfirmAction'
import InfoDot from '../components/InfoDot'
import { apiFetch, apiFetchAll } from '../lib/api'

const ROLES = [['manager', 'Manager'], ['staff', 'Staff / Trainer']]

/** Who works at this branch, and as what. */
export default function BranchTeam({ branch, canEdit }) {
  const [assignments, setAssignments] = useState(null)
  const [team, setTeam] = useState([])
  const [pick, setPick] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('manager')
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetchAll(`/organizations/current/branches/${branch.id}/team/`),
      apiFetchAll('/organizations/current/team/').catch(() => []),
    ])
      .then(([rows, everyone]) => {
        if (cancelled) return
        setAssignments(rows)
        setTeam(everyone.filter((m) => m.role !== 'owner'))
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [branch.id, refresh])

  async function add(body) {
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/organizations/current/branches/${branch.id}/team/`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setPick('')
      setEmail('')
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function changeRole(assignment, next) {
    setError(null)
    try {
      await apiFetch(`/organizations/current/branches/team/${assignment.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ role: next }),
      })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(assignment) {
    await apiFetch(`/organizations/current/branches/team/${assignment.id}/`, {
      method: 'DELETE',
    })
    setRefresh((n) => n + 1)
  }

  const assigned = new Set((assignments ?? []).map((a) => a.membership))
  const available = team.filter((m) => !assigned.has(m.id))

  return (
    <div className="card wide">
      <div className="row">
        <h2>
          Who works here{' '}
          <InfoDot>
            Nobody assigned means only owners can see this branch. A role here
            is separate from the same person&apos;s role at another branch.
          </InfoDot>
        </h2>
      </div>

      {error && <p className="error">{error}</p>}

      {assignments === null ? (
        <p className="muted">Loading…</p>
      ) : assignments.length === 0 ? (
        <p className="muted">Nobody yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Person</th><th>Role here</th><th /></tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.email}
                  {a.is_pending && <span className="pill trial spaced">invited</span>}
                </td>
                <td>
                  {canEdit ? (
                    <select value={a.role} onChange={(e) => changeRole(a, e.target.value)}>
                      {ROLES.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  ) : (
                    ROLES.find(([v]) => v === a.role)?.[1] ?? a.role
                  )}
                </td>
                <td>
                  {canEdit && (
                    <ConfirmAction
                      label="Remove"
                      heading={`Take ${a.email} off ${branch.name}?`}
                      detail="They lose sight of this branch. Their other branches are untouched."
                      confirmLabel="Yes, remove"
                      onConfirm={() => remove(a)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit && (
        <div className="set-entry">
          <label>Add from team
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose…</option>
              {available.map((m) => (
                <option key={m.id} value={m.id}>{m.email}</option>
              ))}
            </select>
          </label>
          <label>Or invite
            <input type="email" value={email} placeholder="coach@example.com"
                   onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>As
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button
            type="button" disabled={busy || (!pick && !email)}
            onClick={() => add(pick ? { membership: Number(pick), role } : { email, role })}
          >
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      )}
    </div>
  )
}
