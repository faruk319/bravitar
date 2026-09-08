import { useEffect, useState } from 'react'

import { apiFetch, apiPage } from '../lib/api'
import CollectPayment from './CollectPayment'
import BatchesCard from './profile/BatchesCard'
import DocumentsCard from './profile/DocumentsCard'
import MembershipCard from './profile/MembershipCard'
import PassCard from './profile/PassCard'
import PhotoCard from './profile/PhotoCard'
import ReadersCard from './profile/ReadersCard'

const STATUSES = [
  ['active', 'Active'], ['trial', 'Trial'], ['paused', 'Paused'], ['left', 'Left'],
]

const money = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })

/**
 * One member, everything about them, in one place.
 *
 * This is the screen the front desk lives on: their details, their photo,
 * their ID, what plan they are on, which batches they're in and what they
 * owe — all editable from here rather than from four different screens.
 * Every card talks to the same endpoints the list screens use, so nothing
 * here keeps a second copy of anything.
 */
export default function StudentDetail({
  student, branches, canEdit, org, role, onSaved, onClose,
}) {
  const [current, setCurrent] = useState(student)
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
  const [invoices, setInvoices] = useState(null)
  const [collecting, setCollecting] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const gymOn = (org?.verticals ?? []).includes('gym')
  const isManager = ['owner', 'manager'].includes(role)
  const requiresPayment = org?.membership_requires_payment !== false

  useEffect(() => {
    let cancelled = false
    apiPage(`/billing/invoices/?student=${student.id}`)
      .then((page) => !cancelled && setInvoices(page))
      .catch(() => !cancelled && setInvoices(null))
    return () => {
      cancelled = true
    }
  }, [student.id, refresh])

  async function reloadStudent() {
    try {
      setCurrent(await apiFetch(`/students/${student.id}/`))
    } catch {
      // The card that triggered this shows its own error; a failed refresh
      // just means the header is briefly stale.
    }
    onSaved()
  }

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

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/students/${student.id}/`, { method: 'DELETE' })
      onSaved()
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
      setConfirmDelete(false)
    }
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

  if (collecting) {
    return (
      <CollectPayment
        invoice={collecting.id}
        amountDue={collecting.balance}
        heading={`Take payment — ${current.full_name}`}
        note={collecting.description || 'Against this invoice.'}
        onCancel={() => setCollecting(null)}
        onDone={() => {
          setCollecting(null)
          setRefresh((n) => n + 1)
        }}
      />
    )
  }

  return (
    <>
      <div className="row">
        <h1>{current.full_name}</h1>
        <button type="button" className="link" onClick={onClose}>← Back to members</button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="stack wide">
        <PhotoCard student={current} canEdit={canEdit} onChanged={reloadStudent} />

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

        {gymOn && (
          <MembershipCard
            student={current}
            canManage={canEdit}
            requiresPayment={requiresPayment}
          />
        )}

        <PassCard student={current} canManage={canEdit} />

        {isManager && <ReadersCard student={current} canManage={canEdit} />}

        <BatchesCard student={current} canManage={canEdit} />

        {isManager && <DocumentsCard student={current} canManage={canEdit} />}

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
                  <tr>
                    <th>Description</th><th>Amount</th><th>Paid</th><th>Due</th>
                    <th>Status</th>{canEdit && <th />}
                  </tr>
                </thead>
                <tbody>
                  {invoices.items.map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.description || '—'}</td>
                      <td>₹{money(inv.amount)}</td>
                      <td>₹{money(inv.amount_paid)}</td>
                      <td>{inv.due_on}</td>
                      <td><span className={`pill ${inv.status}`}>{inv.status}</span></td>
                      {canEdit && (
                        <td>
                          {Number(inv.balance) > 0 && !inv.is_cancelled && (
                            <button type="button" className="link"
                                    onClick={() => setCollecting(inv)}>
                              Take payment
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {canEdit && (
          <div className="card wide">
            <h2>Remove this member</h2>
            {confirmDelete ? (
              <>
                <p className="muted small">
                  This deletes {current.full_name} along with their photo, ID
                  scans, memberships and batch enrolments. It is refused if they
                  have ever been invoiced — the money history has to name
                  somebody. If they have simply stopped coming, set their status
                  to <strong>Left</strong> instead.
                </p>
                <div className="row-actions">
                  <button type="button" className="danger" disabled={busy} onClick={remove}>
                    {busy ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button type="button" className="link" onClick={() => setConfirmDelete(false)}>
                    Keep them
                  </button>
                </div>
              </>
            ) : (
              <div className="row-actions">
                <button type="button" className="link" onClick={() => setConfirmDelete(true)}>
                  Delete member
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
