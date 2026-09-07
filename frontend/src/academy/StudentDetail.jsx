import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll, apiPage } from '../lib/api'

const STATUSES = [
  ['active', 'Active'], ['trial', 'Trial'], ['paused', 'Paused'], ['left', 'Left'],
]

const money = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })

/** One member: their details, which batches they're in, and what they owe. */
export default function StudentDetail({ student, branches, canEdit, onSaved, onClose }) {
  const [form, setForm] = useState(() => ({
    full_name: student.full_name,
    phone: student.phone ?? '',
    email: student.email ?? '',
    date_of_birth: student.date_of_birth ?? '',
    guardian_name: student.guardian_name ?? '',
    guardian_phone: student.guardian_phone ?? '',
    status: student.status,
    joined_on: student.joined_on,
    branch: student.branch ?? '',
    notes: student.notes ?? '',
  }))
  const [enrolments, setEnrolments] = useState(null)
  const [invoices, setInvoices] = useState(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetchAll(`/batches/enrolments/?student=${student.id}`),
      apiPage(`/billing/invoices/?student=${student.id}`).catch(() => null),
    ])
      .then(([e, i]) => {
        if (cancelled) return
        setEnrolments(e)
        setInvoices(i)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [student.id])

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/students/${student.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...form,
          branch: form.branch === '' ? null : Number(form.branch),
          date_of_birth: form.date_of_birth || null,
        }),
      })
      setSaved(true)
      onSaved()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  const field = (key, label, type = 'text') => (
    <label>
      {label}
      <input
        type={type} value={form[key]} disabled={!canEdit}
        onChange={(e) => { setForm({ ...form, [key]: e.target.value }); setSaved(false) }}
      />
    </label>
  )

  const outstanding = (invoices?.items ?? [])
    .reduce((total, inv) => total + Number(inv.balance), 0)

  return (
    <>
      <div className="row">
        <h1>{student.full_name}</h1>
        <button type="button" className="link" onClick={onClose}>← Back to members</button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="stack wide">
        <form className="card wide" onSubmit={save}>
          <h2>Details</h2>

          <div className="two-up">
            {field('full_name', 'Name')}
            {field('phone', 'Phone')}
          </div>
          <div className="two-up">
            {field('email', 'Email', 'email')}
            {field('date_of_birth', 'Date of birth', 'date')}
          </div>
          <div className="two-up">
            {field('guardian_name', 'Guardian')}
            {field('guardian_phone', 'Guardian phone')}
          </div>

          <div className="set-entry">
            <label>
              Status
              <select
                value={form.status} disabled={!canEdit}
                onChange={(e) => { setForm({ ...form, status: e.target.value }); setSaved(false) }}
              >
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label>
              Branch
              <select
                value={form.branch} disabled={!canEdit}
                onChange={(e) => { setForm({ ...form, branch: e.target.value }); setSaved(false) }}
              >
                <option value="">No branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            {field('joined_on', 'Joined', 'date')}
          </div>

          <label>
            Notes
            <input
              value={form.notes} disabled={!canEdit}
              onChange={(e) => { setForm({ ...form, notes: e.target.value }); setSaved(false) }}
            />
          </label>

          {canEdit && (
            <div className="row-actions">
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
              {saved && <span className="muted small">Saved ✓</span>}
            </div>
          )}
        </form>

        <div className="card wide">
          <h2>Batches</h2>
          {enrolments === null ? (
            <p className="muted">Loading…</p>
          ) : enrolments.length === 0 ? (
            <p className="muted">Not enrolled in any batch yet.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Batch</th><th>Enrolled</th><th>Status</th></tr></thead>
              <tbody>
                {enrolments.map((e) => (
                  <tr key={e.id}>
                    <td>{e.batch_name}</td>
                    <td>{e.enrolled_on}</td>
                    <td>{e.is_active ? 'Active' : `Left ${e.left_on ?? ''}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {invoices && (
          <div className="card wide">
            <div className="row">
              <h2>Fees</h2>
              {outstanding > 0 && (
                <span className="pill overdue">₹{money(outstanding)} outstanding</span>
              )}
            </div>
            {invoices.items.length === 0 ? (
              <p className="muted">No invoices yet.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr><th>Description</th><th>Amount</th><th>Paid</th><th>Due</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {invoices.items.map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.description || '—'}</td>
                      <td>₹{money(inv.amount)}</td>
                      <td>₹{money(inv.amount_paid)}</td>
                      <td>{inv.due_on}</td>
                      <td><span className={`pill ${inv.status}`}>{inv.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </>
  )
}
