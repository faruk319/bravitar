import { useEffect, useState } from 'react'

import { apiFetch, apiPage } from '../lib/api'
import ConfirmAction from '../components/ConfirmAction'
import CollectPayment from './CollectPayment'
import BatchesCard from './profile/BatchesCard'
import DocumentsCard from './profile/DocumentsCard'
import LoginCard from './profile/LoginCard'
import MembershipCard from './profile/MembershipCard'
import PassCard from './profile/PassCard'
import PhotoCard from './profile/PhotoCard'
import TrainerCard from './profile/TrainerCard'
import TransferCard from './profile/TransferCard'
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

  const gymOn = (org?.verticals ?? []).includes('gym')
  // A member of a branch you don't work at: look, ask for them, change nothing.
  const readOnly = current.can_edit === false
  const mayEdit = canEdit && !readOnly
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
    await apiFetch(`/students/${student.id}/`, { method: 'DELETE' })
    onSaved()
    onClose()
  }

  const field = (key, label, type = 'text') => (
    <label>
      {label}
      <input
        type={type} value={form[key]} disabled={!mayEdit}
        onChange={(e) => { setForm({ ...form, [key]: e.target.value }); setSaved(false) }}
      />
    </label>
  )

  // A cancelled invoice keeps its balance as history; nobody owes it.
  const outstanding = (invoices?.items ?? [])
    .filter((inv) => !inv.is_cancelled)
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
        {readOnly && (
          <p className="muted">
            {current.full_name} is at <strong>{current.branch_name}</strong>, which
            you don&apos;t work at. You can see them, and ask for them to be
            moved — nothing here can be changed until that is approved.
          </p>
        )}

        <PhotoCard student={current} canEdit={mayEdit} onChanged={reloadStudent} />

        <TransferCard student={current} canManage={canEdit} readOnly={readOnly} />

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
                value={form.status} disabled={!mayEdit}
                onChange={(e) => { setForm({ ...form, status: e.target.value }); setSaved(false) }}
              >
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label>
              Branch
              <select
                value={form.branch} disabled={!mayEdit}
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
              value={form.notes} disabled={!mayEdit}
              onChange={(e) => { setForm({ ...form, notes: e.target.value }); setSaved(false) }}
            />
          </label>

          {mayEdit && (
            <div className="row-actions">
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
              {saved && <span className="muted small">Saved ✓</span>}
            </div>
          )}
        </form>

        {gymOn && (
          <MembershipCard
            student={current}
            canManage={mayEdit}
            requiresPayment={requiresPayment}
          />
        )}

        {gymOn && isManager && (
          <TrainerCard student={current} canManage={mayEdit} />
        )}

        {isManager && (
          <LoginCard
            student={current}
            canManage={mayEdit}
            onChanged={reloadStudent}
          />
        )}

        <PassCard student={current} canManage={mayEdit} />

        {isManager && <ReadersCard student={current} canManage={mayEdit} />}

        <BatchesCard student={current} canManage={mayEdit} />

        {isManager && <DocumentsCard student={current} canManage={mayEdit} />}

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
                    <th>Status</th>{mayEdit && <th />}
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
                      {mayEdit && (
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

        {mayEdit && (
          <div className="card wide">
            <h2>Remove this member</h2>
            <p className="muted small">
              If they have simply stopped coming, set their status to{' '}
              <strong>Left</strong> instead — deleting is refused once they have
              been invoiced, because the money history has to name somebody.
            </p>
            <div className="row-actions">
              <ConfirmAction
                label="Delete member"
                heading={`Delete ${current.full_name}?`}
                detail="Their photo, ID scans, memberships and batch enrolments go with them. This can't be undone."
                confirmLabel="Yes, delete"
                busyLabel="Deleting…"
                onConfirm={remove}
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
