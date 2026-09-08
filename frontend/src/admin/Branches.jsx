import { useEffect, useState } from 'react'

import ConfirmAction from '../components/ConfirmAction'
import { apiFetch, apiFetchAll } from '../lib/api'
import { verticalLabel } from '../lib/verticals'

/** The academy's locations. Also the unit of access — Team says who works where. */

const blank = () => ({
  name: '', address: '', phone: '', email: '', is_primary: false,
  verticals: [], managers: [],
})

function BranchForm({ branch, academyVerticals, team, onSaved, onCancel }) {
  const [form, setForm] = useState(() =>
    branch
      ? {
          name: branch.name,
          address: branch.address ?? '',
          phone: branch.phone ?? '',
          email: branch.email ?? '',
          is_primary: branch.is_primary,
          verticals: branch.verticals ?? [],
          managers: (team ?? []).filter((m) => m.branches.includes(branch.id)).map((m) => m.id),
        }
      : blank(),
  )
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch(
        branch
          ? `/organizations/current/branches/${branch.id}/`
          : '/organizations/current/branches/',
        { method: branch ? 'PATCH' : 'POST', body: JSON.stringify(form) },
      )
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const set = (key) => (e) =>
    setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  return (
    <form className="card wide" onSubmit={save}>
      <h2>{branch ? `Edit ${branch.name}` : 'New branch'}</h2>

      <div className="two-up">
        <label>Name
          <input required value={form.name} placeholder="Andheri West" onChange={set('name')} />
        </label>
        <label>Phone
          <input value={form.phone} onChange={set('phone')} />
        </label>
      </div>

      <label>Address
        <input value={form.address} onChange={set('address')} />
      </label>

      <label>Email
        <input type="email" value={form.email} onChange={set('email')} />
      </label>

      {academyVerticals.length > 1 && (
        <fieldset>
          <legend>Sports run here</legend>
          <p className="muted small">
            Leave all of them ticked unless this branch runs only some — a
            pool-less branch has no business offering swimming.
          </p>
          <div className="vertical-grid">
            {academyVerticals.map((value) => {
              const on = form.verticals.length === 0 || form.verticals.includes(value)
              return (
                <label key={value} className="checkbox">
                  <input
                    type="checkbox" checked={on}
                    onChange={() => {
                      const current = form.verticals.length === 0
                        ? academyVerticals
                        : form.verticals
                      const next = on
                        ? current.filter((v) => v !== value)
                        : [...current, value]
                      setForm({
                        ...form,
                        verticals: next.length === academyVerticals.length ? [] : next,
                      })
                    }}
                  />
                  {verticalLabel(value)}
                </label>
              )
            })}
          </div>
        </fieldset>
      )}

      {team.length > 0 && (
        <fieldset>
          <legend>Who runs it</legend>
          <p className="muted small">
            Anyone not on the list can&apos;t see this branch at all. Leave it
            empty and it stays owner-only until you assign somebody.
          </p>
          <div className="vertical-grid">
            {team.map((member) => (
              <label key={member.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={form.managers.includes(member.id)}
                  onChange={() => setForm({
                    ...form,
                    managers: form.managers.includes(member.id)
                      ? form.managers.filter((id) => id !== member.id)
                      : [...form.managers, member.id],
                  })}
                />
                {member.email} ({member.role})
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <label className="checkbox">
        <input type="checkbox" checked={form.is_primary} onChange={set('is_primary')} />
        Main branch
      </label>
      <span className="muted small">
        A member signed up without a branch lands here. Only one branch can be
        the main one — setting this clears whichever was.
      </span>

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save branch'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function Branches({ role, org }) {
  const academyVerticals = org?.verticals ?? []
  const [team, setTeam] = useState([])
  const [branches, setBranches] = useState(null)
  const [editing, setEditing] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  const isOwner = role === 'owner'

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetchAll('/organizations/current/branches/'),
      // Owners assign; anyone else just sees the counts.
      apiFetchAll('/organizations/current/team/').catch(() => []),
    ])
      .then(([rows, people]) => {
        if (cancelled) return
        setBranches(rows)
        setTeam(people.filter((m) => m.role !== 'owner'))
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function remove(branch) {
    await apiFetch(`/organizations/current/branches/${branch.id}/`, { method: 'DELETE' })
    setRefresh((n) => n + 1)
  }

  if (editing) {
    return (
      <BranchForm
        branch={editing === 'new' ? null : editing}
        academyVerticals={academyVerticals}
        team={team}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          setRefresh((n) => n + 1)
        }}
      />
    )
  }

  return (
    <>
      <h1>Branches</h1>
      <p className="muted">
        Where this academy operates. Members, batches and check-ins belong to a
        branch, and Team decides who works at which.
      </p>

      {error && <p className="error">{error}</p>}

      {isOwner && (
        <div className="filters">
          <button type="button" onClick={() => setEditing('new')}>+ New branch</button>
        </div>
      )}

      {branches === null ? (
        <p className="muted">Loading…</p>
      ) : branches.length === 0 ? (
        <p className="muted">
          One location, so nothing to divide up. Add a branch when you open a
          second — until then nobody is restricted by branch.
        </p>
      ) : (
        <div className="card wide">
          <table className="data-table">
            <thead>
              <tr>
                <th>Branch</th><th>Contact</th><th>Members</th><th>Batches</th>
                <th>Team</th>{isOwner && <th />}
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.id}>
                  <td>
                    <strong>{branch.name}</strong>
                    {branch.is_primary && (
                      <span className="pill spaced">main</span>
                    )}
                    {branch.address && (
                      <div className="muted small">{branch.address}</div>
                    )}
                    {branch.verticals?.length > 0 && (
                      <div className="muted small">
                        {branch.offers.map(verticalLabel).join(', ')} only
                      </div>
                    )}
                  </td>
                  <td className="muted small">
                    {branch.phone && <div>{branch.phone}</div>}
                    {branch.email && <div>{branch.email}</div>}
                    {!branch.phone && !branch.email && '—'}
                  </td>
                  <td>{branch.student_count}</td>
                  <td>{branch.batch_count}</td>
                  <td>
                    {branch.team_count === 0
                      ? <span className="pill pending">nobody yet</span>
                      : branch.team_count}
                  </td>
                  {isOwner && (
                    <td>
                      <div className="row-actions">
                        <button type="button" className="link"
                                onClick={() => setEditing(branch)}>
                          Edit
                        </button>
                        <ConfirmAction
                          label="Delete"
                          heading={`Delete ${branch.name}?`}
                          detail={
                            branch.student_count || branch.batch_count
                              ? `It still has ${branch.student_count} members and ${branch.batch_count} batches, so this will be refused — move them first.`
                              : "Nothing is filed here, so nothing is lost. This can't be undone."
                          }
                          confirmLabel="Yes, delete it"
                          onConfirm={() => remove(branch)}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {isOwner && branches.some((b) => b.team_count === 0) && (
            <p className="muted small">
              A branch with nobody assigned is invisible to every manager —
              only owners can see it. Assign people under Team.
            </p>
          )}
        </div>
      )}
    </>
  )
}
