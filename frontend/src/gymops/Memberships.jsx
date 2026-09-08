import { useEffect, useState } from 'react'

import CollectPayment from '../academy/CollectPayment'
import StudentPicker from '../academy/StudentPicker'
import { apiFetch, apiFetchAll, apiPage } from '../lib/api'

const money = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })
const today = () => new Date().toISOString().slice(0, 10)

function SignUpMember({ tiers, onDone, onCancel }) {
  const [student, setStudent] = useState(null)
  const [tierId, setTierId] = useState('')
  const [startedOn, setStartedOn] = useState(today)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const tier = tiers.find((t) => String(t.id) === tierId)

  async function save(event) {
    event.preventDefault()
    if (!student || !tier) {
      setError('Pick a member and a plan.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/gym-ops/subscriptions/', {
        method: 'POST',
        body: JSON.stringify({
          student: student.id, tier: tier.id, started_on: startedOn,
        }),
      })
      onDone()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  // Shown before saving so the end date is never a surprise.
  const endsOn = tier
    ? new Date(new Date(startedOn).getTime() + (tier.duration_days - 1) * 86400000)
        .toISOString().slice(0, 10)
    : null

  return (
    <form className="card wide" onSubmit={save}>
      <h2>Put a member on a plan</h2>

      <label>Member<StudentPicker value={student} onChange={setStudent} /></label>

      <div className="set-entry">
        <label>Plan
          <select value={tierId} onChange={(e) => setTierId(e.target.value)}>
            <option value="">Choose a plan…</option>
            {tiers.filter((t) => t.is_active).map((t) => (
              <option key={t.id} value={t.id}>{t.name} — ₹{money(t.price)}</option>
            ))}
          </select>
        </label>
        <label>Starts
          <input type="date" required value={startedOn}
                 onChange={(e) => setStartedOn(e.target.value)} />
        </label>
      </div>

      {tier && (
        <p className="muted small">
          Runs {tier.duration_days} days — ends <strong>{endsOn}</strong> · ₹{money(tier.price)}
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Start membership'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function Memberships({ role }) {
  const [overview, setOverview] = useState(null)
  const [subscriptions, setSubscriptions] = useState(null)
  const [tiers, setTiers] = useState([])
  const [status, setStatus] = useState('')
  const [signingUp, setSigningUp] = useState(false)
  const [collecting, setCollecting] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  const canManage = ['owner', 'manager'].includes(role)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('/gym-ops/overview/'),
      apiPage(`/gym-ops/subscriptions/${status ? `?status=${status}` : ''}`),
      apiFetchAll('/gym-ops/tiers/'),
    ])
      .then(([o, s, t]) => {
        if (cancelled) return
        setOverview(o)
        setSubscriptions(s)
        setTiers(t)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [status, refresh])

  async function cancel(subscription) {
    setError(null)
    try {
      await apiFetch(`/gym-ops/subscriptions/${subscription.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ cancelled_on: today() }),
      })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  if (error && !overview) return <p className="error">{error}</p>
  if (!overview) return <p className="muted">Loading…</p>

  return (
    <>
      <h1>Memberships</h1>
      <p className="muted">
        Who is on a plan and until when. Starting a membership raises its
        invoice; taking the payment is what turns it from <strong>pending</strong>
        into <strong>active</strong>.
      </p>

      <div className="stat-row">
        <div className="stat-tile">
          <span className="muted small">Current members</span>
          <div className="stat-value">{overview.current_members}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Awaiting payment</span>
          <div className="stat-value">{overview.counts.pending ?? 0}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Expiring soon</span>
          <div className="stat-value">{overview.counts.expiring ?? 0}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Lapsed</span>
          <div className="stat-value">{overview.counts.expired ?? 0}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">On current plans</span>
          <div className="stat-value">₹{money(overview.value_on_current_memberships)}</div>
        </div>
      </div>

      {overview.per_tier.length > 0 && (
        <div className="card wide">
          <h2>By plan</h2>
          <table className="data-table">
            <thead><tr><th>Plan</th><th>Members</th><th>Value</th></tr></thead>
            <tbody>
              {overview.per_tier.map((row) => (
                <tr key={row.tier}>
                  <td>{row.tier_name}</td>
                  <td>{row.members}</td>
                  <td>₹{money(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All memberships</option>
          <option value="pending">Awaiting payment</option>
          <option value="active">Running</option>
          <option value="upcoming">Upcoming</option>
          <option value="expired">Lapsed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {canManage && tiers.some((t) => t.is_active) && (
          <button type="button" onClick={() => setSigningUp(true)}>+ Start a membership</button>
        )}
      </div>

      {canManage && signingUp && (
        <SignUpMember
          tiers={tiers}
          onCancel={() => setSigningUp(false)}
          onDone={() => {
            setSigningUp(false)
            setRefresh((n) => n + 1)
          }}
        />
      )}

      {canManage && collecting && (
        <CollectPayment
          invoice={collecting.invoice}
          amountDue={collecting.amount_due}
          heading={`Take payment — ${collecting.student_name}`}
          note="This records against the same invoice you see under Fees & Billing."
          onCancel={() => setCollecting(null)}
          onDone={() => {
            setCollecting(null)
            setRefresh((n) => n + 1)
          }}
        />
      )}

      {error && <p className="error">{error}</p>}

      <div className="card wide">
        {subscriptions === null ? (
          <p className="muted">Loading…</p>
        ) : subscriptions.items.length === 0 ? (
          <p className="muted">Nothing here yet.</p>
        ) : (
          <>
            <p className="muted small">
              Showing {subscriptions.items.length} of {subscriptions.count}
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member</th><th>Plan</th><th>Started</th><th>Expires</th>
                  <th>Left</th><th>Status</th><th>Fee</th>{canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {subscriptions.items.map((s) => (
                  <tr key={s.id}>
                    <td>{s.student_name}</td>
                    <td>{s.tier_name}</td>
                    <td>{s.started_on}</td>
                    <td>{s.expires_on}</td>
                    <td>
                      {s.status === 'cancelled'
                        ? '—'
                        : s.days_remaining >= 0
                          ? `${s.days_remaining}d`
                          : `${Math.abs(s.days_remaining)}d ago`}
                    </td>
                    <td><span className={`pill ${s.status}`}>{s.status}</span></td>
                    <td>
                      {s.invoice_status ? (
                        <span className={`pill ${s.invoice_status}`}>
                          {s.invoice_status === 'paid'
                            ? 'paid'
                            : `₹${money(s.amount_due)} due`}
                        </span>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                    {canManage && (
                      <td>
                        <div className="row-actions">
                          {Number(s.amount_due) > 0 && !s.cancelled_on && (
                            <button type="button" className="link"
                                    onClick={() => setCollecting(s)}>
                              Take payment
                            </button>
                          )}
                          {!s.cancelled_on && (
                            <button type="button" className="link" onClick={() => cancel(s)}>
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            <details className="lifecycle">
              <summary className="muted small">What do these statuses mean?</summary>
              <ul>
                {LIFECYCLE.map(([value, meaning]) => (
                  <li key={value}>
                    <span className={`pill ${value}`}>{value}</span>
                    <span className="muted small">{meaning}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">
                Only <strong>active</strong> and <strong>expiring</strong> let a
                member through the door. If your gym lets members pay later,
                switch off &ldquo;require payment before access&rdquo; in Settings
                and memberships go live on their start date instead.
              </p>
            </details>
          </>
        )}
      </div>
    </>
  )
}
