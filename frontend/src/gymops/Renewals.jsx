import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'

/**
 * Who is about to lapse, and who already has.
 *
 * Sending the reminder itself needs a WhatsApp/SMS provider that isn't wired
 * up yet, so this is the list that work is done from: it carries the contact
 * details and a ready-to-send message, and marks who has been chased.
 */

const WINDOWS = [3, 5, 7, 14, 30]

function reminderText(row, academyName) {
  const when = row.days_remaining < 0
    ? `expired ${Math.abs(row.days_remaining)} day${Math.abs(row.days_remaining) === 1 ? '' : 's'} ago`
    : row.days_remaining === 0
      ? 'expires today'
      : `expires in ${row.days_remaining} day${row.days_remaining === 1 ? '' : 's'}`
  return `Hi ${row.student_name.split(' ')[0]}, your ${row.tier_name} membership at ${academyName} ${when} (${row.expires_on}). Renew to keep your access going.`
}

function Row({ row, academyName, onCopied }) {
  const message = reminderText(row, academyName)

  return (
    <tr>
      <td>{row.student_name}</td>
      <td>{row.tier_name}</td>
      <td>{row.expires_on}</td>
      <td>
        {row.days_remaining < 0
          ? `${Math.abs(row.days_remaining)}d ago`
          : row.days_remaining === 0 ? 'today' : `${row.days_remaining}d`}
      </td>
      <td>{row.phone || row.email || <span className="muted">no contact</span>}</td>
      <td className="row-actions">
        {row.phone && (
          <a
            className="link"
            href={`https://wa.me/${row.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp
          </a>
        )}
        <button
          type="button" className="link"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message)
              onCopied(row.id)
            } catch {
              onCopied(null)
            }
          }}
        >
          Copy message
        </button>
      </td>
    </tr>
  )
}

export default function Renewals({ org }) {
  const [data, setData] = useState(null)
  const [days, setDays] = useState(5)
  const [copied, setCopied] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiFetch(`/gym-ops/expiring/?days=${days}`)
      .then((result) => !cancelled && setData(result))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [days])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>

  const headers = (
    <tr>
      <th>Member</th><th>Plan</th><th>Expires</th><th>Left</th><th>Contact</th><th />
    </tr>
  )

  return (
    <>
      <h1>Renewals</h1>
      <p className="muted">
        A member who quietly expires is a member who quietly stops coming.
      </p>

      <div className="filters">
        <label>
          Looking ahead
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {WINDOWS.map((n) => <option key={n} value={n}>{n} days</option>)}
          </select>
        </label>
        {copied && <span className="muted small">Message copied ✓</span>}
      </div>

      <div className="stat-row">
        <div className="stat-tile">
          <span className="muted small">Expiring in {days} days</span>
          <div className="stat-value">{data.expiring.length}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Already lapsed</span>
          <div className="stat-value overdue">{data.expired.length}</div>
        </div>
      </div>

      <div className="card wide">
        <h2>Expiring soon</h2>
        {data.expiring.length === 0 ? (
          <p className="muted">Nobody is due in the next {days} days.</p>
        ) : (
          <table className="data-table">
            <thead>{headers}</thead>
            <tbody>
              {data.expiring.map((row) => (
                <Row key={row.id} row={row} academyName={org.name} onCopied={setCopied} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card wide">
        <h2>Already lapsed</h2>
        <p className="muted small">Expired in the last 30 days — still worth a call.</p>
        {data.expired.length === 0 ? (
          <p className="muted">Nobody has lapsed recently.</p>
        ) : (
          <table className="data-table">
            <thead>{headers}</thead>
            <tbody>
              {data.expired.map((row) => (
                <Row key={row.id} row={row} academyName={org.name} onCopied={setCopied} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card wide">
        <h2>Automatic reminders</h2>
        <p className="muted small">
          Sending these without anyone clicking needs a WhatsApp or SMS provider
          account, which isn't connected yet. Until it is, this list is the
          work: the WhatsApp link opens a pre-written message, and Copy message
          gives you the same text for SMS or email.
        </p>
      </div>
    </>
  )
}
