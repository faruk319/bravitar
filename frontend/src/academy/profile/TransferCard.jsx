import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../../lib/api'
import { useBranches } from '../useBranches'

/**
 * Moving a member to another branch.
 *
 * You can see anybody from any branch but only edit your own, so taking a
 * member is asked for. The branch losing them decides.
 */
export default function TransferCard({ student, canManage, readOnly }) {
  const branches = useBranches()
  const [transfers, setTransfers] = useState(null)
  const [toBranch, setToBranch] = useState('')
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetchAll(`/students/transfers/?student=${student.id}`)
      .then((rows) => !cancelled && setTransfers(rows.filter((r) => r.student === student.id)))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [student.id, refresh])

  async function ask(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/students/transfers/', {
        method: 'POST',
        body: JSON.stringify({ student: student.id, to_branch: Number(toBranch), reason }),
      })
      setAsking(false)
      setToBranch('')
      setReason('')
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function decide(transfer, action) {
    setError(null)
    try {
      await apiFetch(`/students/transfers/${transfer.id}/${action}/`, { method: 'POST' })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  const open = (transfers ?? []).find((t) => t.is_open)
  const elsewhere = branches.filter((b) => b.id !== student.branch)

  // Nothing to say in a single-branch academy.
  if (branches.length < 2 && !open) return null

  return (
    <div className="card wide">
      <div className="row">
        <h2>Branch</h2>
        {canManage && !open && !asking && elsewhere.length > 0 && (
          <button type="button" className="link" onClick={() => setAsking(true)}>
            Ask to move them
          </button>
        )}
      </div>

      <p className="muted small">
        Currently at <strong>{student.branch_name ?? 'no branch'}</strong>.
        {readOnly && ' You can see them from here but not change anything until they are moved.'}
      </p>

      {error && <p className="error">{error}</p>}

      {open && (
        <div className="card">
          <p>
            <strong>{open.from_branch_name ?? 'No branch'} → {open.to_branch_name}</strong>{' '}
            <span className="pill pending">waiting</span>
          </p>
          {open.reason && <p className="muted small">{open.reason}</p>}
          {canManage && (
            <div className="row-actions">
              <button type="button" onClick={() => decide(open, 'approve')}>
                Approve
              </button>
              <button type="button" className="link" onClick={() => decide(open, 'decline')}>
                Decline
              </button>
              <button type="button" className="link" onClick={() => decide(open, 'withdraw')}>
                Withdraw
              </button>
            </div>
          )}
          <p className="muted small">
            Only {open.from_branch_name ?? 'the academy'} can approve or decline;
            only {open.to_branch_name} can withdraw.
          </p>
        </div>
      )}

      {canManage && asking && (
        <form className="set-entry" onSubmit={ask}>
          <label>Move to
            <select value={toBranch} onChange={(e) => setToBranch(e.target.value)}>
              <option value="">Choose a branch…</option>
              {elsewhere.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>Why
            <input value={reason} placeholder="Moved house"
                   onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="submit" disabled={!toBranch || busy}>
            {busy ? 'Asking…' : 'Ask'}
          </button>
          <button type="button" className="link" onClick={() => setAsking(false)}>Cancel</button>
        </form>
      )}

      {transfers?.some((t) => !t.is_open) && (
        <table className="data-table">
          <thead><tr><th>Move</th><th>Asked</th><th>Outcome</th></tr></thead>
          <tbody>
            {transfers.filter((t) => !t.is_open).map((t) => (
              <tr key={t.id}>
                <td>{t.from_branch_name ?? '—'} → {t.to_branch_name}</td>
                <td>{t.requested_at?.slice(0, 10)}</td>
                <td><span className={`pill ${t.status}`}>{t.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
