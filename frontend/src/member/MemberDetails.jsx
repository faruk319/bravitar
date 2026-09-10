import { useEffect, useState } from 'react'

import InfoDot from '../components/InfoDot'
import { apiFetch } from '../lib/api'

/** The four things a member may change about themselves. Name, branch,
 *  status and joined date are the academy's record, so they are shown but
 *  not editable — the backend refuses them either way. */

export default function MemberDetails({ member }) {
  const [form, setForm] = useState(null)
  const [fixed, setFixed] = useState(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiFetch(`/member/${member.id}/`)
      .then((d) => {
        if (cancelled) return
        setForm({
          phone: d.phone ?? '', email: d.email ?? '',
          guardian_name: d.guardian_name ?? '', guardian_phone: d.guardian_phone ?? '',
        })
        setFixed(d)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [member.id])

  const set = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value })
    setSaved(false)
  }

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/member/${member.id}/`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      })
      setSaved(true)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  if (error && !form) return <p className="error">{error}</p>
  if (!form) return <p className="muted">Loading…</p>

  return (
    <form className="card wide" onSubmit={save}>
      <div className="row">
        <h2>My details</h2>
        <InfoDot>
          Your name, branch and joining date are the academy&apos;s record.
          Ask the desk to change those.
        </InfoDot>
      </div>

      <div className="two-up">
        <label>Phone<input value={form.phone} onChange={set('phone')} /></label>
        <label>Email<input type="email" value={form.email} onChange={set('email')} /></label>
      </div>

      <div className="two-up">
        <label>Guardian
          <input value={form.guardian_name} onChange={set('guardian_name')} />
        </label>
        <label>Guardian phone
          <input value={form.guardian_phone} onChange={set('guardian_phone')} />
        </label>
      </div>

      <p className="muted small">
        {fixed.full_name} · joined {fixed.joined_on}
        {fixed.branch ? ` · ${fixed.branch}` : ''}
      </p>

      {error && <p className="error">{error}</p>}

      <div className="row-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        {saved && <span className="muted small">Saved ✓</span>}
      </div>
    </form>
  )
}
