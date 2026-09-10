import { useEffect, useState } from 'react'

import ConfirmAction from '../components/ConfirmAction'
import StudentPicker from './StudentPicker'
import { apiFetch, apiFetchAll } from '../lib/api'

/** One tab of Batches: a batch's sessions day by day, and who has a place.
 *  A "class" is a batch; this is one dated run of it. */

const today = () => new Date().toISOString().slice(0, 10)
const addDays = (from, days) =>
  new Date(new Date(from).getTime() + days * 86400000).toISOString().slice(0, 10)

const dayLabel = (value) =>
  new Date(value).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' })
const timeLabel = (value) => (value ? value.slice(0, 5) : '')

function BookForm({ session, onDone, onCancel }) {
  const [student, setStudent] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const full = session.places_left === 0

  async function save(event) {
    event.preventDefault()
    if (!student) return
    setBusy(true)
    setError(null)
    try {
      const booking = await apiFetch('/batches/bookings/', {
        method: 'POST',
        body: JSON.stringify({
          batch: session.batch,
          student: student.id,
          session_date: session.session_date,
        }),
      })
      onDone(booking)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card wide" onSubmit={save}>
      <h2>{session.batch_name} — {dayLabel(session.session_date)}</h2>
      <p className="muted small">
        {timeLabel(session.start_time)}
        {session.capacity !== null && ` · ${session.places_left} of ${session.capacity} left`}
        {full && ' · joins the waiting list'}
      </p>

      <label>Member<StudentPicker value={student} onChange={setStudent} /></label>

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={!student || busy}>
          {busy ? 'Saving…' : full ? 'Join the list' : 'Book a place'}
        </button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function Bookings() {
  const [from, setFrom] = useState(today)
  const [sessions, setSessions] = useState(null)
  const [bookings, setBookings] = useState([])
  const [enrolments, setEnrolments] = useState([])
  const [booking, setBooking] = useState(null)
  const [open, setOpen] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const to = addDays(from, 6)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch(`/batches/sessions/?from=${from}&to=${to}`),
      apiFetchAll(`/batches/bookings/?from=${from}&to=${to}`),
      apiFetchAll('/batches/enrolments/'),
    ])
      .then(([calendar, rows, roster]) => {
        if (cancelled) return
        setSessions(calendar.sessions)
        setBookings(rows)
        setEnrolments(roster.filter((e) => e.is_active))
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [from, to, refresh])

  async function cancel(row) {
    await apiFetch(`/batches/bookings/${row.id}/cancel/`, { method: 'POST' })
    setRefresh((n) => n + 1)
  }

  async function setComing(session, studentId, coming) {
    await apiFetch('/batches/sessions/skip/', {
      method: 'POST',
      body: JSON.stringify({
        batch: session.batch,
        student: studentId,
        session_date: session.session_date,
        coming,
      }),
    })
    setRefresh((n) => n + 1)
  }

  if (booking) {
    return (
      <BookForm
        session={booking}
        onCancel={() => setBooking(null)}
        onDone={() => {
          setBooking(null)
          setRefresh((n) => n + 1)
        }}
      />
    )
  }

  const key = (session) => `${session.batch}-${session.session_date}`

  const rowsFor = (session) => bookings.filter(
    (b) => b.batch === session.batch && b.session_date === session.session_date,
  )

  /** Who is in this session: the batch's regulars, then that day's drop-ins.
   *  A regular holds a place with no row, so a `skipped` row is the only
   *  thing that takes them out. */
  function peopleIn(session) {
    const rows = rowsFor(session)
    const skipped = new Set(
      rows.filter((r) => r.status === 'skipped').map((r) => r.student),
    )
    const regulars = enrolments
      .filter((e) => e.batch === session.batch
        && e.enrolled_on <= session.session_date
        && (!e.left_on || e.left_on >= session.session_date))
      .map((e) => ({
        id: `reg-${e.id}`,
        student: e.student,
        name: e.student_name,
        regular: true,
        away: skipped.has(e.student),
      }))
    const dropIns = rows
      .filter((r) => ['booked', 'waitlisted'].includes(r.status))
      .map((r) => ({
        id: r.id, student: r.student, name: r.student_name,
        regular: false, status: r.status, row: r,
      }))
    return [...regulars, ...dropIns]
  }

  return (
    <>
      <div className="filters">
        <label>Week from
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <button type="button" className="link" onClick={() => setFrom(addDays(from, -7))}>
          ← Earlier
        </button>
        <button type="button" className="link" onClick={() => setFrom(addDays(from, 7))}>
          Later →
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {sessions === null ? (
        <p className="muted">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="muted">Nothing runs this week.</p>
      ) : (
        <div className="card wide">
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th><th>Class</th><th>Time</th><th>Who</th>
                <th>Places</th><th>Waiting</th><th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const showing = open === key(session)
                const people = showing ? peopleIn(session) : []
                return [
                  <tr key={key(session)}>
                    <td>{dayLabel(session.session_date)}</td>
                    <td>
                      <button type="button" className="link"
                              onClick={() => setOpen(showing ? null : key(session))}>
                        {session.batch_name}
                      </button>
                      <div className="muted small">{session.coach || 'No coach set'}</div>
                    </td>
                    <td>{timeLabel(session.start_time) || '—'}</td>
                    <td className="muted small">
                      {session.regulars - session.skipped} regular
                      {session.drop_ins > 0 && ` + ${session.drop_ins} drop-in`}
                      {session.skipped > 0 && ` · ${session.skipped} away`}
                    </td>
                    <td>
                      {session.capacity === null
                        ? <span className="muted small">no limit</span>
                        : session.places_left === 0
                          ? <span className="pill left">full</span>
                          : `${session.places_left} of ${session.capacity}`}
                    </td>
                    <td>
                      {session.waiting > 0
                        ? <span className="pill pending">{session.waiting}</span>
                        : '—'}
                    </td>
                    <td>
                      <button type="button" className="link" onClick={() => setBooking(session)}>
                        {session.places_left === 0 ? 'Join list' : 'Book'}
                      </button>
                    </td>
                  </tr>,
                  showing && (
                    <tr key={`${key(session)}-who`} className="subrow">
                      <td colSpan={7}>
                        {people.length === 0 ? (
                          <span className="muted small">Nobody in this one yet.</span>
                        ) : (
                          <div className="booking-list">
                            {people.map((person) => (
                              <span
                                key={person.id}
                                className={person.away ? 'booking-chip away' : 'booking-chip'}
                              >
                                {person.name}
                                {person.regular ? (
                                  <>
                                    <span className={person.away ? 'pill left' : 'pill active'}>
                                      {person.away ? 'away' : 'regular'}
                                    </span>
                                    {person.away ? (
                                      <button
                                        type="button" className="link"
                                        onClick={() => setComing(session, person.student, true)}
                                      >
                                        coming
                                      </button>
                                    ) : (
                                      <ConfirmAction
                                        label="×"
                                        heading={`${person.name} not coming on ${dayLabel(session.session_date)}?`}
                                        detail="Their place is free for that day only, and goes to whoever is first on the waiting list. They stay in the batch."
                                        confirmLabel="Yes, free the place"
                                        onConfirm={() => setComing(session, person.student, false)}
                                      />
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <span className={`pill ${person.status}`}>{person.status}</span>
                                    <ConfirmAction
                                      label="×"
                                      heading={`Cancel ${person.name}'s place?`}
                                      detail={person.status === 'booked'
                                        ? 'The place goes to whoever is first on the waiting list.'
                                        : 'They come off the waiting list.'}
                                      confirmLabel="Yes, cancel"
                                      onConfirm={() => cancel(person.row)}
                                    />
                                  </>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
