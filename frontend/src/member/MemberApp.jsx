import { useEffect, useState } from 'react'

import MemberClasses from './MemberClasses'
import MemberDetails from './MemberDetails'
import MemberHistory from './MemberHistory'
import { apiFetch } from '../lib/api'

/**
 * What a member sees of their own record.
 *
 * Everything here is scoped by the backend to the signed-in person, so there
 * is no academy picker and no branch filter — those are the academy's
 * questions, not theirs. The member picker only appears for a login that
 * covers more than one person, which is how a parent reaches their children.
 */

const money = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })

const TABS = [
  { key: 'classes', label: 'Classes' },
  { key: 'history', label: 'Attendance & fees' },
  { key: 'details', label: 'My details' },
]

function Overview({ member }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiFetch(`/member/${member.id}/overview/`)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [member.id])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>

  return (
    <div className="stat-row">
      <div className="stat-tile">
        <span className="muted small">Plan</span>
        <div className="stat-value">{data.plan ? data.plan.name : '—'}</div>
        {data.plan && (
          <span className="muted small">
            {data.plan.status === 'pending'
              ? 'Not paid yet'
              : `${data.plan.days_remaining} days left`}
          </span>
        )}
      </div>
      <div className="stat-tile">
        <span className="muted small">Owed</span>
        <div className="stat-value">₹{money(data.owed)}</div>
      </div>
      <div className="stat-tile">
        <span className="muted small">Can you train</span>
        <div className="stat-value">
          {data.may_train
            ? <span className="pill active">yes</span>
            : <span className="pill left">no</span>}
        </div>
        {!data.may_train && <span className="muted small">{data.why_not}</span>}
      </div>
    </div>
  )
}

export default function MemberApp({ members, onSignOut }) {
  const [who, setWho] = useState(members[0])
  const [tab, setTab] = useState('classes')

  return (
    <div className="member-shell">
      <header className="member-header">
        <div>
          <strong>{who.full_name}</strong>
          <div className="muted small">
            {who.academy}{who.branch ? ` · ${who.branch}` : ''}
          </div>
        </div>

        <div className="row-actions">
          {members.length > 1 && (
            <select
              value={who.id}
              onChange={(e) =>
                setWho(members.find((m) => String(m.id) === e.target.value))
              }
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name}</option>
              ))}
            </select>
          )}
          <button type="button" className="link" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <main className="content">
        <Overview key={`overview-${who.id}`} member={who} />

        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={tab === t.key ? 'tab on' : 'tab'}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'classes' && <MemberClasses key={`c-${who.id}`} member={who} />}
        {tab === 'history' && <MemberHistory key={`h-${who.id}`} member={who} />}
        {tab === 'details' && <MemberDetails key={`d-${who.id}`} member={who} />}
      </main>
    </div>
  )
}
