import { useEffect, useState } from 'react'

import BranchTeam from './BranchTeam'
import ConfirmAction from '../components/ConfirmAction'
import InfoDot from '../components/InfoDot'
import { apiFetch, apiFetchAll } from '../lib/api'
import { verticalLabel } from '../lib/verticals'

/** The academy's locations. Also the unit of access — a role is held per branch. */

const blank = () => ({ name: '', address: '', phone: '', email: '', verticals: [] })

function BranchForm({ branch, academyVerticals, canEdit, onSaved, onClose }) {
  const [form, setForm] = useState(() =>
    branch
      ? {
          name: branch.name,
          address: branch.address ?? '',
          phone: branch.phone ?? '',
          email: branch.email ?? '',
          verticals: branch.verticals ?? [],
        }
      : blank(),
  )
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const set = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value })
    setSaved(false)
  }

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await apiFetch(
        branch
          ? `/organizations/current/branches/${branch.id}/`
          : '/organizations/current/branches/',
        { method: branch ? 'PATCH' : 'POST', body: JSON.stringify(form) },
      )
      setSaved(true)
      onSaved(result)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function setOpen(open) {
    setError(null)
    try {
      const result = await apiFetch(
        `/organizations/current/branches/${branch.id}/${open ? 'reopen' : 'close'}/`,
        { method: 'POST' },
      )
      onSaved(result)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <div className="row-actions">
        <button type="button" className="link" onClick={onClose}>← Branches</button>
      </div>

      <div className="row">
        <h1>{branch ? branch.name : 'New branch'}</h1>
        {branch?.is_primary && <span className="pill spaced">main branch</span>}
        {branch && !branch.is_open && <span className="pill left spaced">closed</span>}
      </div>

      {error && <p className="error">{error}</p>}

      {branch && (
        <div className="stat-row">
          <div className="stat-tile">
            <span className="muted small">Members</span>
            <div className="stat-value">{branch.student_count}</div>
          </div>
          <div className="stat-tile">
            <span className="muted small">Batches</span>
            <div className="stat-value">{branch.batch_count}</div>
          </div>
          <div className="stat-tile">
            <span className="muted small">Team</span>
            <div className="stat-value">{branch.team_count}</div>
          </div>
          <div className="stat-tile">
            <span className="muted small">Here now</span>
            <div className="stat-value">{branch.here_now}</div>
          </div>
        </div>
      )}

      <form className="card wide" onSubmit={save}>
        <h2>Details</h2>

        <div className="two-up">
          <label>Name
            <input required value={form.name} disabled={!canEdit} onChange={set('name')} />
          </label>
          <label>Phone
            <input value={form.phone} disabled={!canEdit} onChange={set('phone')} />
          </label>
        </div>

        <div className="two-up">
          <label>Address
            <input value={form.address} disabled={!canEdit} onChange={set('address')} />
          </label>
          <label>Email
            <input type="email" value={form.email} disabled={!canEdit} onChange={set('email')} />
          </label>
        </div>

        {academyVerticals.length > 1 && (
          <fieldset>
            <legend>
              Sports{' '}
              <InfoDot>
                All of them unless you untick some. A branch can only offer what
                the academy runs.
              </InfoDot>
            </legend>
            <div className="vertical-grid">
              {academyVerticals.map((value) => {
                const on = form.verticals.length === 0 || form.verticals.includes(value)
                return (
                  <label key={value} className="checkbox">
                    <input
                      type="checkbox" checked={on} disabled={!canEdit}
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
                        setSaved(false)
                      }}
                    />
                    {verticalLabel(value)}
                  </label>
                )
              })}
            </div>
          </fieldset>
        )}

        {canEdit && (
          <div className="row-actions">
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            {saved && <span className="muted small">Saved ✓</span>}
          </div>
        )}
      </form>

      {branch && <BranchTeam branch={branch} canEdit={canEdit} />}

      {branch && canEdit && (
        <div className="card wide">
          <h2>
            {branch.is_open ? 'Close this branch' : 'Reopen this branch'}{' '}
            <InfoDot>
              Closing keeps everything that happened here and stops the branch
              being offered for anything new.
            </InfoDot>
          </h2>
          <div className="row-actions">
            {branch.is_open ? (
              <ConfirmAction
                label="Close branch"
                heading={`Close ${branch.name}?`}
                detail={branch.student_count
                  ? `${branch.student_count} members are still filed here — move them first, or they stay at a closed branch.`
                  : 'It stops being offered for new members and batches. Nothing is deleted.'}
                confirmLabel="Yes, close it"
                onConfirm={() => setOpen(false)}
              />
            ) : (
              <button type="button" onClick={() => setOpen(true)}>Reopen</button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default function Branches({ role, org }) {
  const academyVerticals = org?.verticals ?? []
  const [branches, setBranches] = useState(null)
  const [editing, setEditing] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  const isOwner = role === 'owner'

  useEffect(() => {
    let cancelled = false
    apiFetchAll('/organizations/current/branches/')
      .then((rows) => {
        if (cancelled) return
        setBranches(rows)
        // Keep the open branch in step after a save.
        setEditing((current) =>
          current && current !== 'new'
            ? rows.find((b) => b.id === current.id) ?? null
            : current,
        )
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
        canEdit={isOwner}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setRefresh((n) => n + 1)
          setEditing(saved?.id ? saved : null)
        }}
      />
    )
  }

  return (
    <>
      <div className="row">
        <h1>Branches</h1>
        <InfoDot>
          Locations of this academy. Members, batches and check-ins belong to
          one, and each person holds a role per branch.
        </InfoDot>
      </div>

      {error && <p className="error">{error}</p>}

      {isOwner && (
        <div className="filters">
          <button type="button" onClick={() => setEditing('new')}>+ New branch</button>
        </div>
      )}

      {branches === null ? (
        <p className="muted">Loading…</p>
      ) : branches.length === 0 ? (
        <p className="muted">One location, so nothing to divide up.</p>
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
                <tr key={branch.id} className={branch.is_open ? '' : 'revoked-row'}>
                  <td>
                    <button type="button" className="link" onClick={() => setEditing(branch)}>
                      {branch.name}
                    </button>
                    {branch.is_primary && <span className="pill spaced">main</span>}
                    {!branch.is_open && <span className="pill left spaced">closed</span>}
                    {branch.address && <div className="muted small">{branch.address}</div>}
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
                      ? <span className="pill pending">nobody</span>
                      : branch.team_count}
                  </td>
                  {isOwner && (
                    <td>
                      <div className="row-actions">
                        <button type="button" className="link" onClick={() => setEditing(branch)}>
                          Open
                        </button>
                        {branch.student_count === 0 && branch.batch_count === 0 && (
                          <ConfirmAction
                            label="Delete"
                            heading={`Delete ${branch.name}?`}
                            detail="Nothing is filed here, so nothing is lost. This can't be undone."
                            confirmLabel="Yes, delete it"
                            onConfirm={() => remove(branch)}
                          />
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
