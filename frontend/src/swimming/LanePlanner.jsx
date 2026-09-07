import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../lib/api'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function BookLane({ pool, batches, onBooked, onCancel }) {
  const [form, setForm] = useState({
    lane_number: 1, day_of_week: 0, start_time: '', end_time: '', batch: '', note: '',
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function book(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/swimming/lanes/', {
        method: 'POST',
        body: JSON.stringify({
          pool: pool.id,
          lane_number: Number(form.lane_number),
          day_of_week: Number(form.day_of_week),
          start_time: form.start_time,
          end_time: form.end_time,
          batch: form.batch === '' ? null : Number(form.batch),
          note: form.note,
        }),
      })
      onBooked()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card wide" onSubmit={book}>
      <h2>Book a lane in {pool.name}</h2>
      <div className="set-entry">
        <label>Lane
          <select value={form.lane_number}
                  onChange={(e) => setForm({ ...form, lane_number: e.target.value })}>
            {Array.from({ length: pool.lane_count }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>Lane {n}</option>
            ))}
          </select>
        </label>
        <label>Day
          <select value={form.day_of_week}
                  onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
        <label>From
          <input type="time" required value={form.start_time}
                 onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
        </label>
        <label>To
          <input type="time" required value={form.end_time}
                 onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
        </label>
        <label>Batch
          <select value={form.batch}
                  onChange={(e) => setForm({ ...form, batch: e.target.value })}>
            <option value="">Just held</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Booking…' : 'Book lane'}</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function LanePlanner({ role }) {
  const [pools, setPools] = useState([])
  const [poolId, setPoolId] = useState('')
  const [bookings, setBookings] = useState([])
  const [batches, setBatches] = useState([])
  const [booking, setBooking] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)

  const canManage = ['owner', 'manager'].includes(role)

  useEffect(() => {
    apiFetchAll('/swimming/pools/')
      .then((data) => {
        setPools(data)
        if (data.length) setPoolId(String(data[0].id))
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    if (!poolId) return
    let cancelled = false
    Promise.all([
      apiFetchAll(`/swimming/lanes/?pool=${poolId}`),
      apiFetchAll('/batches/?active=true'),
    ])
      .then(([lanes, batchList]) => {
        if (cancelled) return
        setBookings(lanes)
        setBatches(batchList)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [poolId, refresh])

  const pool = pools.find((p) => String(p.id) === poolId)

  if (error) return <p className="error">{error}</p>

  return (
    <>
      <h1>Lanes &amp; Pool Slots</h1>
      <p className="muted">Which lane belongs to which batch, and when.</p>

      <div className="filters">
        <select value={poolId} onChange={(e) => setPoolId(e.target.value)}>
          {pools.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.lane_count} lanes)</option>
          ))}
        </select>
        {canManage && pool && (
          <button type="button" onClick={() => setBooking(true)}>+ Book a lane</button>
        )}
      </div>

      {canManage && booking && pool && (
        <BookLane
          pool={pool}
          batches={batches}
          onCancel={() => setBooking(false)}
          onBooked={() => {
            setBooking(false)
            setRefresh((n) => n + 1)
          }}
        />
      )}

      {!pool ? (
        <p className="muted">No pools set up yet.</p>
      ) : (
        <div className="card wide">
          <div className="lane-grid" style={{ gridTemplateColumns: `5rem repeat(${DAYS.length}, 1fr)` }}>
            <div className="lane-head" />
            {DAYS.map((day) => <div key={day} className="lane-head">{day}</div>)}

            {Array.from({ length: pool.lane_count }, (_, i) => i + 1).map((lane) => (
              <div key={lane} style={{ display: 'contents' }}>
                <div className="lane-label">Lane {lane}</div>
                {DAYS.map((day, dayIndex) => {
                  const slots = bookings.filter(
                    (b) => b.lane_number === lane && b.day_of_week === dayIndex,
                  )
                  return (
                    <div key={day} className="lane-cell">
                      {slots.map((slot) => (
                        <div key={slot.id} className="lane-slot">
                          <strong>{slot.start_time.slice(0, 5)}</strong>
                          <span className="muted small">{slot.batch_name ?? slot.note ?? 'Held'}</span>
                          {canManage && (
                            <button
                              type="button" className="link tiny"
                              onClick={async () => {
                                await apiFetch(`/swimming/lanes/${slot.id}/`, { method: 'DELETE' })
                                setRefresh((n) => n + 1)
                              }}
                            >
                              remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <p className="muted small">
            A lane can hold only one booking at a time — overlapping slots are refused when saved.
          </p>
        </div>
      )}
    </>
  )
}
