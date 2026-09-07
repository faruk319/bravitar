import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../lib/api'
import { useBranches } from './useBranches'

const PIPELINE = ['new', 'contacted', 'trial_scheduled', 'trial_done']
const LABEL = {
  new: 'New',
  contacted: 'Contacted',
  trial_scheduled: 'Trial scheduled',
  trial_done: 'Trial done',
  converted: 'Converted',
  lost: 'Lost',
}

const SOURCES = [
  ['walk_in', 'Walk-in'], ['phone', 'Phone'], ['website', 'Website'],
  ['referral', 'Referral'], ['social', 'Social media'], ['other', 'Other'],
]

function NewEnquiry({ branches, verticals, onCreated, onCancel }) {
  const [form, setForm] = useState(() => ({
    name: '', phone: '', email: '', source: 'walk_in',
    interested_in: verticals[0] ?? '', branch: '',
    follow_up_on: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    notes: '',
  }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function create(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/enquiries/', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          branch: form.branch === '' ? null : Number(form.branch),
          follow_up_on: form.follow_up_on || null,
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
      <h2>New enquiry</h2>
      <p className="muted small">
        Write the walk-in down before they leave — that's the leak this closes.
      </p>

      <div className="two-up">
        <label>Name
          <input required value={form.name}
                 onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>Phone
          <input value={form.phone}
                 onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </label>
      </div>

      <div className="set-entry">
        <label>Email
          <input type="email" value={form.email}
                 onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>Heard via
          <select value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}>
            {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Interested in
          <select value={form.interested_in}
                  onChange={(e) => setForm({ ...form, interested_in: e.target.value })}>
            <option value="">Not sure</option>
            {verticals.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label>Branch
          <select value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}>
            <option value="">No branch</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label>Follow up on
          <input type="date" value={form.follow_up_on}
                 onChange={(e) => setForm({ ...form, follow_up_on: e.target.value })} />
        </label>
      </div>

      <label>Notes
        <input value={form.notes} placeholder="What did they ask about?"
               onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save enquiry'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function Enquiries({ role, org }) {
  const [funnel, setFunnel] = useState(null)
  const [enquiries, setEnquiries] = useState(null)
  const [status, setStatus] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [busyId, setBusyId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)
  const branches = useBranches()

  const canManage = ['owner', 'manager', 'staff'].includes(role)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('/enquiries/funnel/'),
      apiFetchAll(`/enquiries/${status ? `?status=${status}` : ''}`),
    ])
      .then(([f, e]) => {
        if (cancelled) return
        setFunnel(f)
        setEnquiries(e)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [status, refresh])

  async function advance(enquiry, nextStatus) {
    setError(null)
    try {
      await apiFetch(`/enquiries/${enquiry.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  async function convert(enquiry) {
    setBusyId(enquiry.id)
    setError(null)
    try {
      await apiFetch(`/enquiries/${enquiry.id}/convert/`, { method: 'POST' })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusyId(null)
  }

  if (error && !funnel) return <p className="error">{error}</p>
  if (!funnel) return <p className="muted">Loading…</p>

  return (
    <>
      <h1>Enquiries</h1>
      <p className="muted">Every lead, from first contact to enrolment.</p>

      <div className="stat-row">
        <div className="stat-tile">
          <span className="muted small">Total enquiries</span>
          <div className="stat-value">{funnel.total}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Still open</span>
          <div className="stat-value">{funnel.open}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Converted</span>
          <div className="stat-value">{funnel.converted}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Conversion rate</span>
          <div className="stat-value">
            {funnel.conversion_rate === null ? '—' : `${Math.round(funnel.conversion_rate * 100)}%`}
          </div>
        </div>
      </div>

      {canManage && (
        <div className="filters">
          <button type="button" onClick={() => setCreating(true)}>+ New enquiry</button>
        </div>
      )}

      {creating && (
        <NewEnquiry
          branches={branches}
          verticals={org?.verticals ?? []}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            setRefresh((n) => n + 1)
          }}
        />
      )}

      <div className="funnel">
        {PIPELINE.map((stage) => (
          <button
            key={stage}
            type="button"
            className={status === stage ? 'funnel-stage active' : 'funnel-stage'}
            onClick={() => setStatus(status === stage ? '' : stage)}
          >
            <span className="funnel-count">{funnel.by_status[stage] ?? 0}</span>
            <span className="muted small">{LABEL[stage]}</span>
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card wide">
        {enquiries === null ? (
          <p className="muted">Loading…</p>
        ) : enquiries.length === 0 ? (
          <p className="muted">No enquiries at this stage.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Phone</th><th>Source</th><th>Wants</th><th>Stage</th><th /></tr>
            </thead>
            <tbody>
              {enquiries.map((e) => {
                const index = PIPELINE.indexOf(e.status)
                const next = index >= 0 && index < PIPELINE.length - 1 ? PIPELINE[index + 1] : null
                return (
                  <tr key={e.id}>
                    <td>{e.name}</td>
                    <td>{e.phone || '—'}</td>
                    <td>{e.source}</td>
                    <td>{e.interested_in || '—'}</td>
                    <td><span className={`pill ${e.status}`}>{LABEL[e.status] ?? e.status}</span></td>
                    <td className="row-actions">
                      {next && (
                        <button type="button" className="link" onClick={() => advance(e, next)}>
                          → {LABEL[next]}
                        </button>
                      )}
                      {e.status !== 'converted' && e.status !== 'lost' && (
                        <button type="button" className="link" disabled={busyId === e.id}
                                onClick={() => convert(e)}>
                          {busyId === e.id ? 'Converting…' : 'Convert'}
                        </button>
                      )}
                      {e.converted_student_name && (
                        <span className="muted small">→ {e.converted_student_name}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
