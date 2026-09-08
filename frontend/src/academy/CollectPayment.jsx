import { useState } from 'react'

import { apiFetch } from '../lib/api'

/**
 * Recording a payment against an invoice.
 *
 * One component for every screen that takes money — the sign-up flow,
 * Memberships, Fees & Billing, and a member's own profile — because there is
 * one invoice behind all of them and four slightly different forms is how the
 * totals start disagreeing.
 */

const money = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })
const today = () => new Date().toISOString().slice(0, 10)

export const PAYMENT_METHODS = [
  ['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'],
  ['bank_transfer', 'Bank transfer'], ['other', 'Other'],
]

export default function CollectPayment({ invoice, amountDue, heading, note, onDone, onCancel }) {
  const [amount, setAmount] = useState(String(amountDue ?? ''))
  const [paidOn, setPaidOn] = useState(today)
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/billing/payments/', {
        method: 'POST',
        body: JSON.stringify({
          invoice, amount, paid_on: paidOn, method, reference,
        }),
      })
      onDone()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const short = Number(amount) > 0 && Number(amount) < Number(amountDue)

  return (
    <form className="card wide" onSubmit={save}>
      <h2>{heading ?? 'Take payment'}</h2>
      <p className="muted small">
        ₹{money(amountDue)} outstanding. {note}
      </p>

      <div className="set-entry">
        <label>Amount
          <input type="number" step="0.01" min="0.01" required value={amount}
                 onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>Received on
          <input type="date" required value={paidOn}
                 onChange={(e) => setPaidOn(e.target.value)} />
        </label>
        <label>Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>Reference
          <input value={reference} placeholder="UPI ref, receipt no."
                 onChange={(e) => setReference(e.target.value)} />
        </label>
      </div>

      {short && (
        <p className="muted small">
          Part payment — ₹{money(Number(amountDue) - Number(amount))} stays outstanding.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button>
        {onCancel && (
          <button type="button" className="link" onClick={onCancel}>Cancel</button>
        )}
      </div>
    </form>
  )
}
