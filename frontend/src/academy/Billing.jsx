import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'

const money = (value) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })

function RecordPayment({ invoice, onDone }) {
  const [amount, setAmount] = useState(invoice.balance)
  const [method, setMethod] = useState('upi')
  const [error, setError] = useState(null)

  async function submit(event) {
    event.preventDefault()
    setError(null)
    try {
      await apiFetch('/billing/payments/', {
        method: 'POST',
        body: JSON.stringify({
          invoice: invoice.id,
          amount,
          method,
          paid_on: new Date().toISOString().slice(0, 10),
        }),
      })
      onDone()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <form className="set-entry" onSubmit={submit}>
      <label>Amount
        <input type="number" step="0.01" min="0.01" required value={amount}
               onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>Method
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {['cash', 'upi', 'card', 'bank_transfer', 'other'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>
      <button type="submit">Record</button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

export default function Billing() {
  const [summary, setSummary] = useState(null)
  const [invoices, setInvoices] = useState(null)
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [paying, setPaying] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('/billing/summary/'),
      apiFetch(`/billing/invoices/${onlyOverdue ? '?status=overdue' : ''}`),
    ])
      .then(([s, i]) => {
        if (cancelled) return
        setSummary(s)
        setInvoices(i)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [onlyOverdue, refresh])

  if (error) return <p className="error">{error}</p>
  if (!summary) return <p className="muted">Loading…</p>

  return (
    <>
      <h1>Fees &amp; Billing</h1>
      <p className="muted">What has been billed, collected, and is still owed.</p>

      <div className="stat-row">
        <div className="stat-tile">
          <span className="muted small">Billed</span>
          <div className="stat-value">₹{money(summary.billed)}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Collected</span>
          <div className="stat-value">₹{money(summary.collected)}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Outstanding</span>
          <div className="stat-value">₹{money(summary.outstanding)}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Overdue</span>
          <div className="stat-value overdue">₹{money(summary.overdue_amount)}</div>
          <span className="muted small">{summary.counts.overdue} invoices</span>
        </div>
      </div>

      <div className="filters">
        <label className="checkbox">
          <input type="checkbox" checked={onlyOverdue}
                 onChange={(e) => setOnlyOverdue(e.target.checked)} />
          Only overdue
        </label>
      </div>

      <div className="card wide">
        {invoices === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <p className="muted small">{invoices.length} invoices</p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member</th><th>Description</th><th>Amount</th>
                  <th>Paid</th><th>Balance</th><th>Due</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {invoices.slice(0, 40).map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.student_name}</td>
                    <td>{inv.description}</td>
                    <td>₹{money(inv.amount)}</td>
                    <td>₹{money(inv.amount_paid)}</td>
                    <td>₹{money(inv.balance)}</td>
                    <td>{inv.due_on}</td>
                    <td><span className={`pill ${inv.status}`}>{inv.status}</span></td>
                    <td>
                      {Number(inv.balance) > 0 && (
                        <button type="button" className="link"
                                onClick={() => setPaying(paying?.id === inv.id ? null : inv)}>
                          {paying?.id === inv.id ? 'Close' : 'Pay'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {invoices.length > 40 && (
              <p className="muted small">Showing the first 40 of {invoices.length}.</p>
            )}
          </>
        )}
      </div>

      {paying && (
        <div className="card wide">
          <h2>Record payment — {paying.student_name}</h2>
          <p className="muted small">
            {paying.description} · ₹{money(paying.balance)} outstanding
          </p>
          <RecordPayment
            invoice={paying}
            onDone={() => {
              setPaying(null)
              setRefresh((n) => n + 1)
            }}
          />
        </div>
      )}
    </>
  )
}
