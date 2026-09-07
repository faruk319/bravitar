import { useEffect, useState } from 'react'

import { apiFetchAll } from '../lib/api'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function LanePlanner() {
  const [pools, setPools] = useState([])
  const [poolId, setPoolId] = useState('')
  const [bookings, setBookings] = useState([])
  const [error, setError] = useState(null)

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
    apiFetchAll(`/swimming/lanes/?pool=${poolId}`)
      .then((data) => !cancelled && setBookings(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [poolId])

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
      </div>

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
