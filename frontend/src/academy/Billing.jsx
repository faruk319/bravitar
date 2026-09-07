import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll, apiPage } from '../lib/api'
import StudentPicker from './StudentPicker'

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

const CYCLES = [
  ['monthly', 'Monthly'], ['quarterly', 'Quarterly'],
  ['half_yearly', 'Half yearly'], ['annual', 'Annual'], ['one_time', 'One time'],
]

const inDays = (days) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

function FeePlans({ plans, onChanged, isGym }) {
  const [form, setForm] = useState({ name: '', amount: '', cycle: 'monthly' })
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)

  async function create(event) {
    event.preventDefault()
    setError(null)
    try {
      await apiFetch('/billing/plans/', { method: 'POST', body: JSON.stringify(form) })
      setForm({ name: '', amount: '', cycle: 'monthly' })
      onChanged()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="card wide">
      <div className="row">
        <h2>{isGym ? 'One-off charges' : 'Fee plans'}</h2>
        <button type="button" className="link" onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : '+ New charge'}
        </button>
      </div>
      <p className="muted small">
        {isGym
          ? 'Joining fees, PT packages, anything that isn\'t a membership. Membership prices live under Membership Plans.'
          : 'Named fees you can raise invoices from.'}
      </p>

      {open && (
        <form className="set-entry" onSubmit={create}>
          <label>Name
            <input required value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>Amount
            <input type="number" step="0.01" min="0.01" required value={form.amount}
                   onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label>Cycle
            <select value={form.cycle}
                    onChange={(e) => setForm({ ...form, cycle: e.target.value })}>
              {CYCLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button type="submit">Save plan</button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      {plans.length === 0 ? (
        <p className="muted">No fee plans yet.</p>
      ) : (
        <table className="data-table">
          <thead><tr><th>Plan</th><th>Amount</th><th>Cycle</th></tr></thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id}>
                <td>{plan.name}</td>
                <td>₹{money(plan.amount)}</td>
                <td>{plan.cycle.replace('_', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function NewInvoice({ plans, onCreated, onCancel }) {
  const [student, setStudent] = useState(null)
  const [planId, setPlanId] = useState('')
  const [form, setForm] = useState(() => ({
    amount: '', description: '',
    issued_on: new Date().toISOString().slice(0, 10),
    due_on: inDays(10),
  }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  function choosePlan(id) {
    setPlanId(id)
    const plan = plans.find((p) => String(p.id) === id)
    if (plan) {
      setForm((f) => ({ ...f, amount: plan.amount, description: f.description || plan.name }))
    }
  }

  async function create(event) {
    event.preventDefault()
    if (!student) {
      setError('Pick a member to invoice.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/billing/invoices/', {
        method: 'POST',
        body: JSON.stringify({
          ...form, student: student.id,
          fee_plan: planId === '' ? null : Number(planId),
        }),
      })
      onCreated()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card wide" onSubmit={create}>
      <h2>Raise an invoice</h2>

      <label>
        Member
        <StudentPicker value={student} onChange={setStudent} />
      </label>

      <div className="set-entry">
        <label>From plan
          <select value={planId} onChange={(e) => choosePlan(e.target.value)}>
            <option value="">One-off</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>Amount
          <input type="number" step="0.01" min="0.01" required value={form.amount}
                 onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </label>
        <label>Issued
          <input type="date" required value={form.issued_on}
                 onChange={(e) => setForm({ ...form, issued_on: e.target.value })} />
        </label>
        <label>Due
          <input type="date" required value={form.due_on}
                 onChange={(e) => setForm({ ...form, due_on: e.target.value })} />
        </label>
      </div>

      <label>Description
        <input value={form.description}
               onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create invoice'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function Billing({ role, org }) {
  const [summary, setSummary] = useState(null)
  const [invoices, setInvoices] = useState(null)
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [paying, setPaying] = useState(null)
  const [plans, setPlans] = useState([])
  const [creating, setCreating] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  // Reading the books is open to anyone running the academy; changing them
  // is a manager's job, and the backend enforces the same split.
  const canBill = ['owner', 'manager'].includes(role)

  // A gym's recurring prices are its membership plans, so calling these
  // "fee plans" alongside them was the confusing part. Here they are what's
  // left: joining fees, PT packages, one-off charges.
  const isGym = (org?.verticals ?? []).includes('gym')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('/billing/summary/'),
      apiPage(`/billing/invoices/${onlyOverdue ? '?status=overdue' : ''}`),
      apiFetchAll('/billing/plans/'),
    ])
      .then(([s, i, p]) => {
        if (cancelled) return
        setSummary(s)
        setInvoices(i)
        setPlans(p)
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
      <p className="muted">
        Every rupee owed and paid, wherever it came from
        {isGym && ' — memberships raise their invoice here automatically'}.
      </p>

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
        {canBill && (
          <button type="button" onClick={() => setCreating(true)}>+ Raise invoice</button>
        )}
      </div>

      {canBill && creating && (
        <NewInvoice
          plans={plans}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            setRefresh((n) => n + 1)
          }}
        />
      )}

      <div className="card wide">
        {invoices === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <p className="muted small">
              Showing {invoices.items.length} of {invoices.count} invoices
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member</th><th>Description</th><th>Amount</th>
                  <th>Paid</th><th>Balance</th><th>Due</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {invoices.items.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.student_name}</td>
                    <td>
                      {inv.description}
                      {inv.description?.includes('membership') && (
                        <span className="tag">membership</span>
                      )}
                    </td>
                    <td>₹{money(inv.amount)}</td>
                    <td>₹{money(inv.amount_paid)}</td>
                    <td>₹{money(inv.balance)}</td>
                    <td>{inv.due_on}</td>
                    <td><span className={`pill ${inv.status}`}>{inv.status}</span></td>
                    <td>
                      {canBill && Number(inv.balance) > 0 && (
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
            {invoices.next && (
              <p className="muted small">
                More invoices exist — narrow the filter to find a specific one.
              </p>
            )}
          </>
        )}
      </div>

      {canBill && <FeePlans plans={plans} isGym={isGym} onChanged={() => setRefresh((n) => n + 1)} />}

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
