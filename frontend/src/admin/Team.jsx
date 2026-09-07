import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../lib/api'

// Members aren't sign-in-able yet — they're tracked under Members as
// enrolment records, not logins. Keep this list in step with Role.ASSIGNABLE.
const ROLES = [
  { value: 'owner', label: 'Owner', hint: 'Everything, including settings and who has access.' },
  { value: 'manager', label: 'Manager', hint: 'Runs the academy and handles fees and invoices.' },
  { value: 'staff', label: 'Staff / Trainer', hint: 'Runs sessions: members, batches, registers.' },
]

export default function Team({ role }) {
  const [team, setTeam] = useState(null)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('staff')
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const isOwner = role === 'owner'

  useEffect(() => {
    let cancelled = false
    apiFetchAll('/organizations/current/team/')
      .then((data) => !cancelled && setTeam(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function invite(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/organizations/current/team/', {
        method: 'POST',
        body: JSON.stringify({ email, role: inviteRole }),
      })
      setEmail('')
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function changeRole(member, nextRole) {
    setError(null)
    try {
      await apiFetch(`/organizations/current/team/${member.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(member) {
    setError(null)
    try {
      await apiFetch(`/organizations/current/team/${member.id}/`, { method: 'DELETE' })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <h1>Team</h1>
      <p className="muted">
        Who can sign in to this academy, and what they can do. Students are
        tracked under Members — they don't get logins yet.
      </p>

      {isOwner && (
        <form className="card wide" onSubmit={invite}>
          <h2>Invite someone</h2>
          <div className="set-entry">
            <label>
              Email
              <input
                type="email" required placeholder="coach@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Role
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <button type="submit" disabled={busy}>{busy ? 'Inviting…' : 'Send invite'}</button>
          </div>
          <p className="muted small">
            They get access the first time they sign in with that address.
          </p>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      <div className="card wide">
        {team === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Email</th><th>Role</th><th>Status</th>{isOwner && <th />}</tr>
            </thead>
            <tbody>
              {team.map((member) => (
                <tr key={member.id}>
                  <td>{member.email}</td>
                  <td>
                    {isOwner ? (
                      <select
                        value={member.role}
                        onChange={(e) => changeRole(member, e.target.value)}
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    ) : (
                      ROLES.find((r) => r.value === member.role)?.label ?? member.role
                    )}
                  </td>
                  <td>
                    <span className={member.is_pending ? 'pill trial' : 'pill active'}>
                      {member.is_pending ? 'invited' : 'joined'}
                    </span>
                  </td>
                  {isOwner && (
                    <td>
                      <button type="button" className="link" onClick={() => remove(member)}>
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card wide">
        <h2>What the roles mean</h2>
        <ul className="role-list">
          {ROLES.map((r) => (
            <li key={r.value}>
              <strong>{r.label}</strong>
              <span className="muted small"> — {r.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
