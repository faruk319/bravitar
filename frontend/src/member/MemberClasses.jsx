import { useEffect, useState } from 'react'

import ConfirmAction from '../components/ConfirmAction'
import { apiFetch } from '../lib/api'

/**
 * The member booking their own place — the point of the waitlist.
 *
 * `standing` comes from the backend rather than being worked out here: the
 * desk and this screen must never disagree about whether somebody has a place.
 */

const dayLabel = (value) =>
  new Date(value).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' })
const timeLabel = (value) => (value ? value.slice(0, 5) : '')

const STANDING = {
  regular: { label: 'you are in this', pill: 'active' },
  booked: { label: 'booked', pill: 'booked' },
  waitlisted: { label: 'waiting', pill: 'waitlisted' },
  away: { label: 'not coming', pill: 'skipped' },
}

export default function MemberClasses({ member }) {
  const [sessions, setSessions] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiFetch(`/member/${member.id}/sessions/`)
      .then((d) => !cancelled && setSessions(d.sessions))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [member.id, refresh])

  async function act(session, action) {
    setBusy(`${session.batch}-${session.session_date}`)
    setError(null)
    try {
      await apiFetch(`/member/${member.id}/bookings/`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          batch: session.batch,
          session_date: session.session_date,
        }),
      })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusy(null)
  }

  if (error && sessions === null) return <p className="error">{error}</p>
  if (sessions === null) return <p className="muted">Loading…</p>
  if (sessions.length === 0) return <p className="muted">Nothing runs in the next two weeks.</p>

  return (
    <>
      {error && <p className="error">{error}</p>}

      <div className="card wide">
        <table className="data-table">
          <thead>
            <tr><th>Day</th><th>Class</th><th>Time</th><th>Places</th><th /></tr>
          </thead>
          <tbody>
            {sessions.map((session) => {
              const id = `${session.batch}-${session.session_date}`
              const standing = STANDING[session.standing]
              const full = session.places_left === 0
              const working = busy === id
              return (
                <tr key={id}>
                  <td>{dayLabel(session.session_date)}</td>
                  <td>
                    {session.batch_name}
                    <div className="muted small">{session.coach || 'No coach set'}</div>
                  </td>
                  <td>{timeLabel(session.start_time) || '—'}</td>
                  <td>
                    {session.capacity === null
                      ? <span className="muted small">no limit</span>
                      : full
                        ? <span className="pill left">full</span>
                        : `${session.places_left} left`}
                  </td>
                  <td>
                    <div className="row-actions">
                      {standing && (
                        <span className={`pill ${standing.pill}`}>{standing.label}</span>
                      )}

                      {session.standing === 'regular' && (
                        <ConfirmAction
                          label="Can't make it"
                          heading={`Not coming on ${dayLabel(session.session_date)}?`}
                          detail="Your place goes to whoever is waiting, for that day only. You stay in the class."
                          confirmLabel="Yes, I'll miss it"
                          onConfirm={() => act(session, 'away')}
                        />
                      )}

                      {session.standing === 'away' && (
                        <button type="button" className="link" disabled={working}
                                onClick={() => act(session, 'coming')}>
                          I can come
                        </button>
                      )}

                      {['booked', 'waitlisted'].includes(session.standing) && (
                        <ConfirmAction
                          label="Cancel"
                          heading={`Give up your place on ${dayLabel(session.session_date)}?`}
                          detail={session.standing === 'booked'
                            ? 'It goes to whoever is first on the waiting list.'
                            : 'You come off the waiting list.'}
                          confirmLabel="Yes, cancel"
                          onConfirm={() => act(session, 'cancel')}
                        />
                      )}

                      {!session.standing && (
                        <button type="button" disabled={working}
                                onClick={() => act(session, 'book')}>
                          {working ? '…' : full ? 'Join the list' : 'Book'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
