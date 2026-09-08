import { useEffect, useState } from 'react'

import ConfirmAction from '../components/ConfirmAction'
import { apiFetch, apiFetchAll } from '../lib/api'
import PluginSettings from './PluginSettings'
import { SELECTABLE_VERTICALS, VERTICALS } from '../lib/verticals'

export default function Settings({ org, role, onOrgChange }) {
  const [name, setName] = useState(org.name)
  const [verticals, setVerticals] = useState(org.verticals)
  const [branches, setBranches] = useState(null)
  const [newBranch, setNewBranch] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const isOwner = role === 'owner'

  // What this academy can pick from: everything shipped, plus anything it is
  // already on, so a withdrawn vertical stays visible and switchable-off.
  const choosable = [
    ...SELECTABLE_VERTICALS,
    ...VERTICALS.filter((v) => !v.implemented && org.verticals.includes(v.value)),
  ]

  useEffect(() => {
    let cancelled = false
    apiFetchAll('/organizations/current/branches/')
      .then((data) => !cancelled && setBranches(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function saveOrg(event) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    try {
      const updated = await apiFetch('/organizations/current/', {
        method: 'PATCH',
        body: JSON.stringify({ name, verticals }),
      })
      onOrgChange(updated)
      setSaved(true)
    } catch (err) {
      setError(err.message)
    }
  }

  function toggleVertical(value) {
    setSaved(false)
    setVerticals((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    )
  }

  async function addBranch(event) {
    event.preventDefault()
    setError(null)
    try {
      await apiFetch('/organizations/current/branches/', {
        method: 'POST',
        body: JSON.stringify({ name: newBranch }),
      })
      setNewBranch('')
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  async function removeBranch(branch) {
    await apiFetch(`/organizations/current/branches/${branch.id}/`, { method: 'DELETE' })
    setRefresh((n) => n + 1)
  }

  return (
    <>
      <h1>Settings</h1>
      <p className="muted">Your academy's name, the modules it uses, and its branches.</p>

      {error && <p className="error">{error}</p>}

      <form className="card wide" onSubmit={saveOrg}>
        <h2>Academy</h2>

        <label>
          Name
          <input value={name} disabled={!isOwner}
                 onChange={(e) => { setName(e.target.value); setSaved(false) }} />
        </label>

        <label>
          Web address
          <input value={`${org.slug}.bravitar.com`} disabled />
          <span className="muted small">
            Fixed — every link and login already points at it.
          </span>
        </label>

        <fieldset>
          <legend>Modules</legend>
          <p className="muted small">
            Turning one off hides its modules and closes its API. Nothing is deleted —
            switch it back on and the data is still there.
          </p>
          <div className="vertical-grid">
            {choosable.map((vertical) => (
              <label key={vertical.value} className="checkbox">
                <input
                  type="checkbox"
                  disabled={!isOwner}
                  checked={verticals.includes(vertical.value)}
                  onChange={() => toggleVertical(vertical.value)}
                />
                {vertical.label}
              </label>
            ))}
          </div>
        </fieldset>

        {isOwner && (
          <div className="row-actions">
            <button type="submit" disabled={verticals.length === 0}>Save changes</button>
            {saved && <span className="muted small">Saved ✓</span>}
            {verticals.length === 0 && (
              <span className="error">Keep at least one module.</span>
            )}
          </div>
        )}
      </form>

      <div className="card wide">
        <h2>Branches</h2>
        {branches === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Members</th><th>Batches</th><th>Primary</th>{isOwner && <th />}</tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.id}>
                  <td>{branch.name}</td>
                  <td>{branch.student_count}</td>
                  <td>{branch.batch_count}</td>
                  <td>{branch.is_primary ? 'Yes' : '—'}</td>
                  {isOwner && (
                    <td>
                      <ConfirmAction
                        label="Delete"
                        heading={`Delete ${branch.name}?`}
                        detail={branch.student_count > 0
                          ? `${branch.student_count} members and ${branch.batch_count} batches are on this branch. They stay, but stop belonging anywhere.`
                          : "This can't be undone."}
                        confirmLabel="Yes, delete it"
                        onConfirm={() => removeBranch(branch)}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {isOwner && (
          <form className="set-entry" onSubmit={addBranch}>
            <label>
              New branch
              <input required value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
            </label>
            <button type="submit">Add branch</button>
          </form>
        )}
      </div>

      <PluginSettings
        org={org}
        verticals={org.verticals}
        branches={branches ?? []}
        canEdit={isOwner}
        onOrgChange={onOrgChange}
      />
    </>
  )
}
