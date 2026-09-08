import { useEffect, useState } from 'react'

import InfoDot from '../components/InfoDot'
import { apiFetch, apiFetchAll } from '../lib/api'

/**
 * Trainers across the academy: who they look after, and what they earned.
 *
 * Assigning happens on the member's own profile — this screen answers the
 * question no single member can, which is what each trainer is owed.
 */

const money = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })
const startOfMonth = () => new Date().toISOString().slice(0, 8) + '01'
const today = () => new Date().toISOString().slice(0, 10)

export default function Trainers() {
  const [from, setFrom] = useState(startOfMonth)
  const [to, setTo] = useState(today)
  const [earnings, setEarnings] = useState(null)
  const [assignments, setAssignments] = useState(null)
  const [open, setOpen] = useState(null)
  const [error, setError] = useState(null)

  // Money is manager-only; who trains whom is not. Fetched apart so staff
  // get the roster rather than an error where the page should be.
  useEffect(() => {
    let cancelled = false
    apiFetchAll('/gym-ops/trainers/?running=true')
      .then((rows) => !cancelled && setAssignments(rows))
      .catch((err) => !cancelled && setError(err.message))
    apiFetch(`/gym-ops/trainers/earnings/?from=${from}&to=${to}`)
      .then((report) => !cancelled && setEarnings(report))
      .catch(() => !cancelled && setEarnings(false))
    return () => {
      cancelled = true
    }
  }, [from, to])

  // One row per trainer: their earnings if we may see them, their clients always.
  const byTrainer = new Map()
  for (const row of earnings ? earnings.trainers : []) {
    byTrainer.set(row.trainer, { ...row, clients: [] })
  }
  for (const a of assignments ?? []) {
    const entry = byTrainer.get(a.trainer)
        ?? { trainer: a.trainer, trainer_email: a.trainer_email, earned: null, clients: [] }
    entry.clients.push(a)
    byTrainer.set(a.trainer, entry)
  }
  const rows = [...byTrainer.values()]
  const showMoney = earnings !== false

  return (
    <>
      <div className="row">
        <h1>Trainers</h1>
        <InfoDot>
          Counted on payments received, not invoices raised — a cut of a bill
          nobody has paid is a promise, not earnings. Assign a trainer from the
          member&apos;s own profile.
        </InfoDot>
      </div>

      {showMoney && (
        <div className="filters">
          <label>From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {assignments === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          Nobody is training anybody yet — assign a trainer from a member&apos;s profile.
        </p>
      ) : (
        <div className="card wide">
          <table className="data-table">
            <thead>
              <tr>
                <th>Trainer</th><th>Members</th>{showMoney && <th>Earned</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const showing = open === row.trainer
                return [
                  <tr key={row.trainer}>
                    <td>
                      <button type="button" className="link"
                              onClick={() => setOpen(showing ? null : row.trainer)}>
                        {row.trainer_email}
                      </button>
                    </td>
                    <td>{row.clients.length}</td>
                    {showMoney && (
                      <td>{row.earned === null ? '—' : `₹${money(row.earned)}`}</td>
                    )}
                  </tr>,
                  showing && (
                    <tr key={`${row.trainer}-who`} className="subrow">
                      <td colSpan={showMoney ? 3 : 2}>
                        {row.clients.length === 0 ? (
                          <span className="muted small">Nobody on their books now.</span>
                        ) : (
                          <div className="booking-list">
                            {row.clients.map((a) => (
                              <span key={a.id} className="booking-chip">
                                {a.student_name}
                                <span className="pill active">
                                  {Number(a.commission_percent)}%
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
            {showMoney && earnings && (
              <tfoot>
                <tr><th>Total</th><th /><th>₹{money(earnings.total)}</th></tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </>
  )
}
