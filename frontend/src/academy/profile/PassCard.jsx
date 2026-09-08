import { useEffect, useState } from 'react'

import { apiFetch, apiObjectUrl, apiPage } from '../../lib/api'

const time = (value) =>
  new Date(value).toLocaleString([], {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })

/** A member's door pass and their recent visits. Reissue kills a leaked pass. */
export default function PassCard({ student, canManage }) {
  const [qr, setQr] = useState(null)
  const [visits, setVisits] = useState(null)
  const [showing, setShowing] = useState(false)
  const [confirmReissue, setConfirmReissue] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiPage(`/attendance/checkins/?student=${student.id}`)
      .then((page) => !cancelled && setVisits(page))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [student.id, refresh])

  // Fetched only when asked for — a profile shouldn't display a working key.
  useEffect(() => {
    if (!showing) return undefined
    let objectUrl = null
    let cancelled = false
    apiObjectUrl(`/attendance/checkins/pass/${student.id}/qr.png`)
      .then((value) => {
        if (cancelled) {
          URL.revokeObjectURL(value)
          return
        }
        objectUrl = value
        setQr(value)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setQr(null)
    }
  }, [showing, student.id, refresh])

  async function reissue() {
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/attendance/checkins/pass/${student.id}/`, { method: 'POST' })
      setConfirmReissue(false)
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  const recent = (visits?.items ?? []).slice(0, 8)

  return (
    <div className="card wide">
      <div className="row">
        <h2>Pass &amp; visits</h2>
        {canManage && (
          <button type="button" className="link" onClick={() => setShowing((v) => !v)}>
            {showing ? 'Hide pass' : 'Show pass'}
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {showing && (
        <div className="photo-capture">
          {qr
            ? <img src={qr} alt="Door pass" className="pass-qr" />
            : <div className="pass-qr empty">Loading…</div>}
          <div>
            <p className="muted small">
              Scanning this checks {student.full_name} in, if their record
              admits them. Print it, or let them keep it on their phone.
            </p>
            {canManage && (
              confirmReissue ? (
                <>
                  <p className="muted small">
                    A new pass is issued and the old one stops working
                    immediately. Anything already printed becomes useless.
                  </p>
                  <div className="row-actions">
                    <button type="button" className="danger" disabled={busy} onClick={reissue}>
                      {busy ? 'Reissuing…' : 'Yes, reissue'}
                    </button>
                    <button type="button" className="link"
                            onClick={() => setConfirmReissue(false)}>
                      Keep it
                    </button>
                  </div>
                </>
              ) : (
                <div className="row-actions">
                  <button type="button" className="link"
                          onClick={() => setConfirmReissue(true)}>
                    Reissue pass
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {visits === null ? (
        <p className="muted">Loading…</p>
      ) : recent.length === 0 ? (
        <p className="muted">No visits yet.</p>
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr><th>When</th><th>How</th><th>For</th><th /></tr>
            </thead>
            <tbody>
              {recent.map((visit) => (
                <tr key={visit.id}>
                  <td>{time(visit.checked_in_at)}</td>
                  <td><span className="pill">{visit.method}</span></td>
                  <td>
                    {visit.minutes != null
                      ? `${visit.minutes} min`
                      : visit.is_inside ? 'still in' : '—'}
                  </td>
                  <td>
                    {visit.admitted
                      ? <span className="pill active">in</span>
                      : <span className="pill pending">{visit.refusal_label}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visits.count > recent.length && (
            <p className="muted small">
              Showing the last {recent.length} of {visits.count} visits.
            </p>
          )}
        </>
      )}
    </div>
  )
}
