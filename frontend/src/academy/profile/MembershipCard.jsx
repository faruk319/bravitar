import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../../lib/api'
import ConfirmAction from '../../components/ConfirmAction'
import CollectPayment from '../CollectPayment'

/**
 * A member's memberships, from their own profile: what they are on now, what
 * they have been on, and the three things you actually do — put them on a
 * plan, take the money, cancel it.
 *
 * Same endpoints as the Memberships screen. That screen answers "who is
 * current across the gym"; this one answers "what is this person on", and
 * neither keeps its own tally.
 */

const money = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })
const today = () => new Date().toISOString().slice(0, 10)

function cancelWarning(subscription, money) {
  const paid = Number(subscription.amount_paid ?? 0)
  const due = Number(subscription.amount_due ?? 0)
  if (due <= 0) return "The membership ends today and they stop being admitted. This can't be undone."
  if (paid > 0) {
    return `They have paid ₹${money(paid)} of it, so the invoice stays and ₹${money(due)} is still owed — `
      + 'refund or credit is your call. This can\'t be undone.'
  }
  return `Nothing has been paid, so the ₹${money(due)} invoice is cancelled with it. This can't be undone.`
}

export default function MembershipCard({ student, canManage, requiresPayment }) {
  const [subscriptions, setSubscriptions] = useState(null)
  const [tiers, setTiers] = useState([])
  const [assigning, setAssigning] = useState(false)
  const [collecting, setCollecting] = useState(null)
  const [tierId, setTierId] = useState('')
  const [startedOn, setStartedOn] = useState(today)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const tier = tiers.find((t) => String(t.id) === tierId)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetchAll(`/gym-ops/subscriptions/?student=${student.id}`),
      apiFetchAll('/gym-ops/tiers/?active=true'),
    ])
      .then(([subs, t]) => {
        if (cancelled) return
        setSubscriptions(subs)
        setTiers(t)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [student.id, refresh])

  async function assign(event) {
    event.preventDefault()
    if (!tier) return
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/gym-ops/subscriptions/', {
        method: 'POST',
        body: JSON.stringify({ student: student.id, tier: tier.id, started_on: startedOn }),
      })
      setAssigning(false)
      setTierId('')
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function cancel(subscription) {
    await apiFetch(`/gym-ops/subscriptions/${subscription.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ cancelled_on: today() }),
    })
    setRefresh((n) => n + 1)
  }

  const endsOn = tier
    ? new Date(new Date(startedOn).getTime() + (tier.duration_days - 1) * 86400000)
        .toISOString().slice(0, 10)
    : null

  const current = (subscriptions ?? []).find((s) => ['active', 'expiring'].includes(s.status))
  const pending = (subscriptions ?? []).find((s) => s.status === 'pending')

  if (collecting) {
    return (
      <CollectPayment
        invoice={collecting.invoice}
        amountDue={collecting.amount_due}
        heading={`Take payment — ${student.full_name}`}
        note={
          requiresPayment
            ? 'The membership turns active as soon as any of this is paid.'
            : 'This is the same invoice you see under Fees & Billing.'
        }
        onCancel={() => setCollecting(null)}
        onDone={() => {
          setCollecting(null)
          setRefresh((n) => n + 1)
        }}
      />
    )
  }

  return (
    <div className="card wide">
      <div className="row">
        <h2>Membership</h2>
        {canManage && !assigning && tiers.length > 0 && (
          <button type="button" className="link" onClick={() => setAssigning(true)}>
            + Put on a plan
          </button>
        )}
      </div>

      {current ? (
        <p className="muted small">
          On <strong>{current.tier_name}</strong> until {current.expires_on} —{' '}
          {current.days_remaining} days left.
        </p>
      ) : pending ? (
        <p className="muted small">
          On <strong>{pending.tier_name}</strong> but <span className="pill pending">pending</span> —
          nothing paid yet, so they cannot train.
        </p>
      ) : subscriptions?.length ? (
        <p className="muted small">No membership running right now.</p>
      ) : null}

      {error && <p className="error">{error}</p>}

      {canManage && assigning && (
        <form className="set-entry" onSubmit={assign}>
          <label>Plan
            <select value={tierId} onChange={(e) => setTierId(e.target.value)}>
              <option value="">Choose a plan…</option>
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>{t.name} — ₹{money(t.price)}</option>
              ))}
            </select>
          </label>
          <label>Starts
            <input type="date" value={startedOn}
                   onChange={(e) => setStartedOn(e.target.value)} />
          </label>
          <button type="submit" disabled={!tier || busy}>
            {busy ? 'Saving…' : 'Start'}
          </button>
          <button type="button" className="link" onClick={() => setAssigning(false)}>Cancel</button>
        </form>
      )}

      {tier && assigning && (
        <p className="muted small">
          Runs {tier.duration_days} days — ends <strong>{endsOn}</strong> · ₹{money(tier.price)}
        </p>
      )}

      {subscriptions === null ? (
        <p className="muted">Loading…</p>
      ) : subscriptions.length === 0 ? (
        <p className="muted">
          Never been on a plan{canManage && tiers.length === 0
            ? ' — and no plans are switched on yet.'
            : '.'}
        </p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Plan</th><th>From</th><th>To</th><th>Status</th><th>Fee</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((s) => (
              <tr key={s.id}>
                <td>{s.tier_name}</td>
                <td>{s.started_on}</td>
                <td>{s.expires_on}</td>
                <td><span className={`pill ${s.status}`}>{s.status}</span></td>
                <td>
                  {s.invoice_status === 'paid'
                    ? <span className="pill paid">paid</span>
                    : Number(s.amount_due) > 0
                      ? <span className={`pill ${s.invoice_status}`}>₹{money(s.amount_due)} due</span>
                      : <span className="muted small">—</span>}
                </td>
                {canManage && (
                  <td>
                    <div className="row-actions">
                      {Number(s.amount_due) > 0 && !s.cancelled_on && (
                        <button type="button" className="link" onClick={() => setCollecting(s)}>
                          Take payment
                        </button>
                      )}
                      {!s.cancelled_on && (
                        <ConfirmAction
                          label="Cancel"
                          heading={`Cancel this ${s.tier_name} membership?`}
                          detail={cancelWarning(s, money)}
                          confirmLabel="Yes, cancel it"
                          onConfirm={() => cancel(s)}
                        />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
