import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../lib/api'

/**
 * Settings that belong to one vertical rather than to the academy as a whole.
 * Each section only appears when its plugin is switched on — an academy that
 * doesn't teach swimming has no business configuring pools.
 */

function Pools({ branches, canEdit }) {
  const [pools, setPools] = useState(null)
  const [form, setForm] = useState({ name: '', lane_count: 6, branch: '' })
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiFetchAll('/swimming/pools/')
      .then((data) => !cancelled && setPools(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function create(event) {
    event.preventDefault()
    setError(null)
    try {
      await apiFetch('/swimming/pools/', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          lane_count: Number(form.lane_count),
          branch: form.branch === '' ? null : Number(form.branch),
        }),
      })
      setForm({ name: '', lane_count: 6, branch: '' })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="card wide">
      <h2>Pools</h2>
      <p className="muted small">Lanes are booked against these on the Lanes screen.</p>

      {error && <p className="error">{error}</p>}

      {pools === null ? (
        <p className="muted">Loading…</p>
      ) : pools.length === 0 ? (
        <p className="muted">No pools yet.</p>
      ) : (
        <table className="data-table">
          <thead><tr><th>Pool</th><th>Lanes</th><th>Branch</th></tr></thead>
          <tbody>
            {pools.map((pool) => (
              <tr key={pool.id}>
                <td>{pool.name}</td>
                <td>{pool.lane_count}</td>
                <td>{pool.branch_name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit && (
        <form className="set-entry" onSubmit={create}>
          <label>Name
            <input required value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>Lanes
            <input type="number" min="1" max="20" required value={form.lane_count}
                   onChange={(e) => setForm({ ...form, lane_count: e.target.value })} />
          </label>
          <label>Branch
            <select value={form.branch}
                    onChange={(e) => setForm({ ...form, branch: e.target.value })}>
              <option value="">No branch</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <button type="submit">Add pool</button>
        </form>
      )}
    </div>
  )
}

function Belts({ canEdit }) {
  const [belts, setBelts] = useState(null)
  const [form, setForm] = useState({ name: '', colour: '#cccccc' })
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiFetchAll('/karate/belts/')
      .then((data) => !cancelled && setBelts(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function create(event) {
    event.preventDefault()
    setError(null)
    try {
      await apiFetch('/karate/belts/', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          // New belts go at the end of the ladder; a student's belt is the
          // highest position they have passed.
          position: (belts?.length ?? 0),
        }),
      })
      setForm({ name: '', colour: '#cccccc' })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="card wide">
      <h2>Belt ladder</h2>
      <p className="muted small">
        Order is the ladder — a student's belt is the highest one they've passed.
      </p>

      {error && <p className="error">{error}</p>}

      {belts === null ? (
        <p className="muted">Loading…</p>
      ) : belts.length === 0 ? (
        <p className="muted">No belts yet.</p>
      ) : (
        <ol className="ladder">
          {belts.map((belt) => (
            <li key={belt.id}>
              <span className="belt-chip" style={{ background: belt.colour || '#ccc' }} />
              {belt.name}
            </li>
          ))}
        </ol>
      )}

      {canEdit && (
        <form className="set-entry" onSubmit={create}>
          <label>New belt
            <input required value={form.name} placeholder="e.g. Red"
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>Colour
            <input type="color" value={form.colour}
                   onChange={(e) => setForm({ ...form, colour: e.target.value })} />
          </label>
          <button type="submit">Add belt</button>
        </form>
      )}
    </div>
  )
}

export default function PluginSettings({ verticals, branches, canEdit }) {
  return (
    <>
      {verticals.includes('swimming') && <Pools branches={branches} canEdit={canEdit} />}
      {verticals.includes('karate') && <Belts canEdit={canEdit} />}
    </>
  )
}
