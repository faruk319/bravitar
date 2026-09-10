import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'

/** What they have done and what they owe. Read-only: paying happens at the
 *  desk until there is a payment gateway, so offering a button here would
 *  promise something the app cannot do. */

const money = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })

export default function MemberHistory({ member }) {
  const [attendance, setAttendance] = useState(null)
  const [invoices, setInvoices] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch(`/member/${member.id}/attendance/`),
      apiFetch(`/member/${member.id}/invoices/`),
    ])
      .then(([a, i]) => {
        if (cancelled) return
        setAttendance(a.records)
        setInvoices(i.invoices)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [member.id])

  if (error) return <p className="error">{error}</p>

  return (
    <>
      <div className="card wide">
        <h2>Fees</h2>
        {invoices === null ? (
          <p className="muted">Loading…</p>
        ) : invoices.length === 0 ? (
          <p className="muted small">Nothing billed yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>What for</th><th>Amount</th><th>Due</th><th>Status</th></tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td>{i.description}</td>
                  <td>
                    ₹{money(i.amount)}
                    {Number(i.balance) > 0 && !['cancelled'].includes(i.status) && (
                      <div className="muted small">₹{money(i.balance)} still due</div>
                    )}
                  </td>
                  <td>{i.due_on}</td>
                  <td><span className={`pill ${i.status}`}>{i.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card wide">
        <h2>Attendance</h2>
        {attendance === null ? (
          <p className="muted">Loading…</p>
        ) : attendance.length === 0 ? (
          <p className="muted small">No visits recorded in the last three months.</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Date</th><th>Class</th><th>Status</th></tr></thead>
            <tbody>
              {attendance.map((r, index) => (
                <tr key={`${r.date}-${r.batch}-${index}`}>
                  <td>{r.date}</td>
                  <td>{r.batch ?? '—'}</td>
                  <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
