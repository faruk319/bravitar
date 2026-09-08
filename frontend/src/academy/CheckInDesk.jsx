import { useCallback, useEffect, useRef, useState } from 'react'

import StudentPicker from '../academy/StudentPicker'
import { apiFetch, apiObjectUrl } from '../lib/api'

/** The front desk. The verdict comes from admission_for; nothing is decided twice. */

const REFUSAL_HELP = {
  no_membership: 'Never been on a plan. Put them on one from their profile.',
  awaiting_payment: 'Signed up but nothing paid. Take the payment and they are in.',
  expired: 'Their plan has run out. Sell them a renewal.',
  cancelled: 'This membership was cancelled.',
  not_started: "Paid, but the plan hasn't started yet.",
}

const time = (value) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function MemberFace({ student }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    if (!student?.id || !student.has_photo) {
      setUrl(null)
      return undefined
    }
    let objectUrl = null
    let cancelled = false
    apiObjectUrl(`/students/${student.id}/photo/`)
      .then((value) => {
        if (cancelled) {
          URL.revokeObjectURL(value)
          return
        }
        objectUrl = value
        setUrl(value)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [student?.id, student?.has_photo])

  return url
    ? <img src={url} alt="" className="photo-preview" />
    : <div className="photo-preview empty">No photo</div>
}

/** Camera scanning via the browser's own BarcodeDetector — an accelerator, not
 * the only way in. Falls back to searching by name. */
function Scanner({ onToken, onError }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [running, setRunning] = useState(false)
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setRunning(false)
  }, [])

  useEffect(() => stop, [stop])

  useEffect(() => {
    if (!running) return undefined

    let cancelled = false
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
    const timer = setInterval(async () => {
      const video = videoRef.current
      if (!video || video.readyState < 2) return
      try {
        const [found] = await detector.detect(video)
        if (found && !cancelled) {
          cancelled = true
          onToken(found.rawValue)
        }
      } catch {
        // A frame that won't decode is the normal case, not an error.
      }
    }, 400)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [running, onToken])

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      setRunning(true)
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
      })
    } catch {
      onError('No camera available — search for the member instead.')
    }
  }

  if (!supported) {
    return (
      <p className="muted small">
        This browser can&apos;t read QR codes. Search for the member below, or
        use Chrome on the desk tablet.
      </p>
    )
  }

  return (
    <div className="photo-capture">
      {running
        ? <video ref={videoRef} autoPlay playsInline muted className="scanner-view" />
        : <div className="scanner-view empty">Camera off</div>}
      <div className="row-actions">
        {running
          ? <button type="button" className="link" onClick={stop}>Stop</button>
          : <button type="button" onClick={start}>Scan a pass</button>}
      </div>
    </div>
  )
}

function Verdict({ visit, onDismiss }) {
  const admitted = visit.admitted
  return (
    <div className={`card wide verdict ${admitted ? 'in' : 'out'}`}>
      <h2>
        {admitted ? `${visit.student_name} — come in` : `${visit.student_name} — not today`}
      </h2>
      <p className="muted small">
        {admitted ? (
          <>
            {visit.tier_name && <>On {visit.tier_name}. </>}
            {visit.already_inside
              ? 'Already checked in — this is the same visit.'
              : `Checked in at ${time(visit.checked_in_at)}.`}
          </>
        ) : (
          <>
            <strong>{visit.refusal_label}.</strong>{' '}
            {REFUSAL_HELP[visit.refused_reason] ?? ''}
          </>
        )}
      </p>
      <div className="row-actions">
        <button type="button" onClick={onDismiss}>Next</button>
      </div>
    </div>
  )
}

export default function CheckInDesk() {
  const [student, setStudent] = useState(null)
  const [verdict, setVerdict] = useState(null)
  const [today, setToday] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetch('/attendance/checkins/today/')
      .then((data) => !cancelled && setToday(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [refresh])

  const admit = useCallback(async (body, path) => {
    setBusy(true)
    setError(null)
    try {
      const visit = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
      setVerdict(visit)
      setStudent(null)
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }, [])

  const onToken = useCallback(
    (token) => admit({ token, device: 'desk' }, '/attendance/checkins/scan/'),
    [admit],
  )

  async function checkOut(visit) {
    setError(null)
    try {
      await apiFetch(`/attendance/checkins/${visit.id}/out/`, { method: 'POST' })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <p className="muted small">
        Scan a pass or find the member. Whether they come in is read off their
        record — nothing is decided twice.
      </p>

      {error && <p className="error">{error}</p>}

      {verdict ? (
        <Verdict visit={verdict} onDismiss={() => setVerdict(null)} />
      ) : (
        <div className="card wide">
          <Scanner onToken={onToken} onError={setError} />

          <hr className="divider" />

          <label>Or find them by name
            <StudentPicker value={student} onChange={setStudent} />
          </label>

          {student && (
            <div className="photo-capture">
              <MemberFace student={student} />
              <div>
                <strong>{student.full_name}</strong>
                {student.phone && <div className="muted small">{student.phone}</div>}
                <div className="row-actions">
                  <button type="button" disabled={busy}
                          onClick={() => admit({ student: student.id }, '/attendance/checkins/')}>
                    {busy ? 'Checking in…' : 'Check in'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {today && (
        <div className="stat-row">
          <div className="stat-tile">
            <span className="muted small">Here now</span>
            <div className="stat-value">{today.counts.inside}</div>
          </div>
          <div className="stat-tile">
            <span className="muted small">Visits today</span>
            <div className="stat-value">{today.counts.admitted}</div>
          </div>
          <div className="stat-tile">
            <span className="muted small">Turned away</span>
            <div className="stat-value">{today.counts.refused}</div>
          </div>
        </div>
      )}

      {today && (
        <div className="card wide">
          <h2>In right now</h2>
          {today.inside.length === 0 ? (
            <p className="muted">Nobody is checked in.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Member</th><th>Plan</th><th>Since</th><th>How</th><th /></tr>
              </thead>
              <tbody>
                {today.inside.map((visit) => (
                  <tr key={visit.id}>
                    <td>{visit.student_name}</td>
                    <td>{visit.tier_name ?? '—'}</td>
                    <td>{time(visit.checked_in_at)}</td>
                    <td><span className="pill">{visit.method}</span></td>
                    <td>
                      <button type="button" className="link" onClick={() => checkOut(visit)}>
                        Check out
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {today && today.refused.length > 0 && (
        <div className="card wide">
          <h2>Turned away today</h2>
          <p className="muted small">
            Each of these is a conversation worth having.
          </p>
          <table className="data-table">
            <thead>
              <tr><th>Member</th><th>Time</th><th>Why</th></tr>
            </thead>
            <tbody>
              {today.refused.map((visit) => (
                <tr key={visit.id}>
                  <td>{visit.student_name}</td>
                  <td>{time(visit.checked_in_at)}</td>
                  <td><span className="pill pending">{visit.refusal_label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </>
  )
}
