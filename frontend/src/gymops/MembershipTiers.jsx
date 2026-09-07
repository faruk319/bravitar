import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../lib/api'

const PERIODS = [
  ['monthly', 'Monthly', 30],
  ['quarterly', 'Quarterly', 90],
  ['half_yearly', 'Half yearly', 180],
  ['yearly', 'Yearly', 365],
  ['custom', 'Custom', null],
]

const money = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })

const blank = () => ({
  name: '', description: '', period: 'monthly', duration_days: 30, price: '',
  includes_personal_trainer: false, class_credits_per_week: '', perks: '',
})

function TierForm({ tier, onSaved, onCancel }) {
  const [form, setForm] = useState(() =>
    tier
      ? {
          name: tier.name, description: tier.description ?? '',
          period: tier.period, duration_days: tier.duration_days,
          price: tier.price,
          includes_personal_trainer: tier.includes_personal_trainer,
          class_credits_per_week: tier.class_credits_per_week ?? '',
          perks: (tier.perks ?? []).join(', '),
        }
      : blank(),
  )
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  function choosePeriod(period) {
    const days = PERIODS.find(([value]) => value === period)?.[2]
    setForm((f) => ({ ...f, period, duration_days: days ?? f.duration_days }))
  }

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch(tier ? `/gym-ops/tiers/${tier.id}/` : '/gym-ops/tiers/', {
        method: tier ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...form,
          duration_days: Number(form.duration_days),
          class_credits_per_week:
            form.class_credits_per_week === '' ? null : Number(form.class_credits_per_week),
          perks: form.perks.split(',').map((p) => p.trim()).filter(Boolean),
        }),
      })
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card wide" onSubmit={save}>
      <h2>{tier ? `Edit ${tier.name}` : 'New plan'}</h2>

      <div className="two-up">
        <label>Name
          <input required value={form.name} placeholder="e.g. Quarterly or VIP"
                 onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>Price
          <input type="number" step="0.01" min="0" required value={form.price}
                 onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </label>
      </div>

      <label>Description
        <input value={form.description}
               onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>

      <div className="set-entry">
        <label>Runs for
          <select value={form.period} onChange={(e) => choosePeriod(e.target.value)}>
            {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Days
          <input
            type="number" min="1" required value={form.duration_days}
            disabled={form.period !== 'custom'}
            onChange={(e) => setForm({ ...form, duration_days: e.target.value })}
          />
        </label>
        <label>Class credits / week
          <input type="number" min="0" placeholder="unlimited"
                 value={form.class_credits_per_week}
                 onChange={(e) => setForm({ ...form, class_credits_per_week: e.target.value })} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={form.includes_personal_trainer}
                 onChange={(e) => setForm({ ...form, includes_personal_trainer: e.target.checked })} />
          Includes a personal trainer
        </label>
      </div>

      <label>Perks
        <input value={form.perks} placeholder="Locker, Steam room, Guest passes"
               onChange={(e) => setForm({ ...form, perks: e.target.value })} />
        <span className="muted small">Comma separated.</span>
      </label>

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function MembershipTiers({ role }) {
  const [tiers, setTiers] = useState(null)
  const [editing, setEditing] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  const canManage = ['owner', 'manager'].includes(role)

  useEffect(() => {
    let cancelled = false
    apiFetchAll('/gym-ops/tiers/')
      .then((data) => !cancelled && setTiers(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function toggleActive(tier) {
    setError(null)
    try {
      await apiFetch(`/gym-ops/tiers/${tier.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !tier.is_active }),
      })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  if (editing) {
    return (
      <TierForm
        tier={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          setRefresh((n) => n + 1)
        }}
      />
    )
  }

  return (
    <>
      <h1>Membership Plans</h1>
      <p className="muted">
        What a member can buy. Everything else — who can walk in, how many
        classes they get, when to chase a renewal — reads off these.
      </p>

      {error && <p className="error">{error}</p>}

      {canManage && (
        <div className="filters">
          <button type="button" onClick={() => setEditing('new')}>+ New plan</button>
        </div>
      )}

      {tiers === null ? (
        <p className="muted">Loading…</p>
      ) : tiers.length === 0 ? (
        <p className="muted">
          No plans yet{canManage ? ' — create one before signing anybody up.' : '.'}
        </p>
      ) : (
        <div className="tier-grid">
          {tiers.map((tier) => (
            <div key={tier.id} className={tier.is_active ? 'card tier' : 'card tier retired'}>
              <div className="row">
                <strong>{tier.name}</strong>
                {!tier.is_active && <span className="pill left">off</span>}
              </div>
              <div className="tier-price">₹{money(tier.price)}</div>
              <span className="muted small">
                {tier.duration_days} days · {tier.active_members} on this plan
              </span>

              {tier.description && <p className="muted small">{tier.description}</p>}

              <ul className="perks">
                {tier.includes_personal_trainer && <li>Personal trainer included</li>}
                <li>
                  {tier.class_credits_per_week === null
                    ? 'Unlimited classes'
                    : `${tier.class_credits_per_week} classes a week`}
                </li>
                {(tier.perks ?? []).map((perk) => <li key={perk}>{perk}</li>)}
              </ul>

              {canManage && (
                <div className="row-actions">
                  <button type="button" className="link" onClick={() => setEditing(tier)}>
                    Edit
                  </button>
                  <button type="button" className="link" onClick={() => toggleActive(tier)}>
                    {tier.is_active ? 'Switch off' : 'Switch on'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
