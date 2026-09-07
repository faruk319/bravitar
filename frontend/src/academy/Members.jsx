import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'
import { useBranches } from './useBranches'

const STATUSES = ['active', 'trial', 'paused', 'left']

export default function Members() {
  const branches = useBranches()
  const [students, setStudents] = useState(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [branch, setBranch] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ full_name: '', phone: '', email: '' })
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    if (branch) params.set('branch', branch)

    const timer = setTimeout(() => {
      apiFetch(`/students/?${params}`)
        .then((data) => !cancelled && setStudents(data))
        .catch((err) => !cancelled && setError(err.message))
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search, status, branch, refresh])

  async function addStudent(event) {
    event.preventDefault()
    setError(null)
    try {
      await apiFetch('/students/', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          branch: branch || null,
          joined_on: new Date().toISOString().slice(0, 10),
        }),
      })
      setForm({ full_name: '', phone: '', email: '' })
      setAdding(false)
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <h1>Members</h1>
      <p className="muted">Everyone enrolled at the academy.</p>

      <div className="filters">
        <input type="search" placeholder="Search by name…" value={search}
               onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button type="button" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : '+ Add member'}
        </button>
      </div>

      {adding && (
        <form className="card wide set-entry" onSubmit={addStudent}>
          <label>Name
            <input required value={form.full_name}
                   onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </label>
          <label>Phone
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label>Email
            <input type="email" value={form.email}
                   onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <button type="submit">Save</button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      <div className="card wide">
        {students === null ? (
          <p className="muted">Loading…</p>
        ) : students.length === 0 ? (
          <p className="muted">No members match those filters.</p>
        ) : (
          <>
            <p className="muted small">{students.length} members</p>
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Phone</th><th>Branch</th><th>Status</th><th>Joined</th></tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td>{s.full_name}</td>
                    <td>{s.phone || '—'}</td>
                    <td>{s.branch_name || '—'}</td>
                    <td><span className={`pill ${s.status}`}>{s.status}</span></td>
                    <td>{s.joined_on}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  )
}
