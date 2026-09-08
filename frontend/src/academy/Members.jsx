import { useEffect, useState } from 'react'

import { apiPage } from '../lib/api'
import SignUpMember from './SignUpMember'
import StudentDetail from './StudentDetail'
import { useBranches } from './useBranches'

const STATUSES = ['active', 'trial', 'paused', 'left']

export default function Members({ role, org }) {
  const branches = useBranches()
  const [students, setStudents] = useState(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [branch, setBranch] = useState('')
  const [adding, setAdding] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState(null)

  const canEdit = ['owner', 'manager'].includes(role)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    if (branch) params.set('branch', branch)

    const timer = setTimeout(() => {
      apiPage(`/students/?${params}`)
        .then((page) => !cancelled && setStudents(page))
        .catch((err) => !cancelled && setError(err.message))
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search, status, branch, refresh])

  // Adding a member is the sign-up flow — there is deliberately only one way
  // to create one, so a member added here and a member signed up at the desk
  // are the same record with the same photo, ID and plan behind them.
  if (adding) {
    return (
      <SignUpMember
        role={role}
        org={org}
        onClose={() => setAdding(false)}
        onSaved={() => setRefresh((n) => n + 1)}
      />
    )
  }

  if (selected) {
    return (
      <StudentDetail
        student={selected}
        branches={branches}
        canEdit={canEdit}
        org={org}
        role={role}
        onClose={() => setSelected(null)}
        onSaved={() => setRefresh((n) => n + 1)}
      />
    )
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
        {canEdit && (
          <button type="button" onClick={() => setAdding(true)}>+ Add member</button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card wide">
        {students === null ? (
          <p className="muted">Loading…</p>
        ) : students.items.length === 0 ? (
          <p className="muted">No members match those filters.</p>
        ) : (
          <>
            <p className="muted small">
              Showing {students.items.length} of {students.count} members
            </p>
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Phone</th><th>Branch</th><th>Status</th><th>Joined</th></tr>
              </thead>
              <tbody>
                {students.items.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button type="button" className="link"
                              onClick={() => setSelected(s)}>
                        {s.full_name}
                      </button>
                    </td>
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
