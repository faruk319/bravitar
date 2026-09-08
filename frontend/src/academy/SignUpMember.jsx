import { useEffect, useRef, useState } from 'react'

import { apiFetch, apiFetchAll, apiUpload } from '../lib/api'
import { PAYMENT_METHODS } from './CollectPayment'
import { useBranches } from './useBranches'

/**
 * Signing somebody up, start to finish, on one screen.
 *
 * The order matches what actually happens at a gym's front desk: take their
 * details, take their photo, take a copy of their ID, put them on a plan, take
 * the money. Each step saves as it is completed rather than everything landing
 * at the end — a walk-in who changes their mind after the photo leaves a
 * member record behind, which is right, and a membership that was never paid
 * for stays visibly pending rather than quietly counting as active.
 */

const money = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })
const today = () => new Date().toISOString().slice(0, 10)

function Step({ number, title, done, active, children, hint }) {
  return (
    <div className={`card wide step${done ? ' done' : ''}${active ? ' current' : ''}`}>
      <div className="step-head">
        <span className="step-number">{done ? '✓' : number}</span>
        <h2>{title}</h2>
      </div>
      {hint && <p className="muted small">{hint}</p>}
      {children}
    </div>
  )
}

function PhotoStep({ student, onDone, onSkip }) {
  const [preview, setPreview] = useState(null)
  const [file, setFile] = useState(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  // Release the camera on the way out — leaving it running keeps the
  // recording light on, which is alarming and rightly so.
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  async function startCamera() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      setCameraOn(true)
      // The element only exists once cameraOn has rendered it.
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
      })
    } catch {
      setError('No camera available — choose a file instead.')
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraOn(false)
  }

  function capture() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      setFile(new File([blob], 'photo.jpg', { type: 'image/jpeg' }))
      setPreview(URL.createObjectURL(blob))
      stopCamera()
    }, 'image/jpeg', 0.9)
  }

  function chooseFile(event) {
    const chosen = event.target.files?.[0]
    if (!chosen) return
    setFile(chosen)
    setPreview(URL.createObjectURL(chosen))
  }

  async function save() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('photo', file)
      await apiUpload(`/students/${student.id}/photo/`, form, 'PUT')
      onDone()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <>
      {error && <p className="error">{error}</p>}

      <div className="photo-capture">
        {preview ? (
          <img src={preview} alt="" className="photo-preview" />
        ) : cameraOn ? (
          <video ref={videoRef} autoPlay playsInline muted className="photo-preview" />
        ) : (
          <div className="photo-preview empty">No photo</div>
        )}

        <div className="row-actions">
          {cameraOn ? (
            <>
              <button type="button" onClick={capture}>Take photo</button>
              <button type="button" className="link" onClick={stopCamera}>Stop camera</button>
            </>
          ) : (
            <button type="button" className="link" onClick={startCamera}>Use camera</button>
          )}
          <label className="link file-pick">
            Choose a file
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} />
          </label>
        </div>
      </div>

      <div className="row-actions">
        <button type="button" onClick={save} disabled={!file || busy}>
          {busy ? 'Uploading…' : 'Save photo'}
        </button>
        <button type="button" className="link" onClick={onSkip}>Skip for now</button>
      </div>
    </>
  )
}

function DocumentStep({ student, kinds, onDone, onSkip }) {
  const [kind, setKind] = useState('aadhaar')
  const [last4, setLast4] = useState('')
  const [file, setFile] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('student', student.id)
      form.append('kind', kind)
      form.append('number_last4', last4)
      form.append('file', file)
      await apiUpload('/students/documents/', form)
      onDone()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <>
      {error && <p className="error">{error}</p>}

      <div className="set-entry">
        <label>Document
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label>Last 4 digits
          <input value={last4} maxLength={4} inputMode="numeric" placeholder="4321"
                 onChange={(e) => setLast4(e.target.value)} />
        </label>
        <label className="file-pick-block">Scan or photo
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                 onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>

      <p className="muted small">
        Only the last four digits are stored — never the whole number. The scan
        itself is visible to owners and managers only.
      </p>

      <div className="row-actions">
        <button type="button" onClick={save} disabled={!file || busy}>
          {busy ? 'Uploading…' : 'Save document'}
        </button>
        <button type="button" className="link" onClick={onSkip}>Skip for now</button>
      </div>
    </>
  )
}

export default function SignUpMember({ role, org, onClose, onSaved }) {
  const branches = useBranches()
  const [tiers, setTiers] = useState([])
  const [kinds, setKinds] = useState([])
  const [loadError, setLoadError] = useState(null)

  // A swimming academy signs people up too; it just has no plan to sell them
  // here. The last two steps appear only for gyms.
  const gymOn = (org?.verticals ?? []).includes('gym')

  const [details, setDetails] = useState({
    full_name: '', phone: '', email: '', date_of_birth: '',
    guardian_name: '', guardian_phone: '', branch: '',
  })
  const [student, setStudent] = useState(null)
  const [photoDone, setPhotoDone] = useState(false)
  const [documentDone, setDocumentDone] = useState(false)

  const [tierId, setTierId] = useState('')
  const [startedOn, setStartedOn] = useState(today)
  const [subscription, setSubscription] = useState(null)

  const [payment, setPayment] = useState({ amount: '', method: 'cash', reference: '' })
  const [paid, setPaid] = useState(false)

  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const canManage = ['owner', 'manager'].includes(role)
  const tier = tiers.find((t) => String(t.id) === tierId)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('/students/meta/'),
      // Asking a non-gym academy for membership plans would be a 403 from the
      // vertical gate, so don't ask.
      gymOn ? apiFetchAll('/gym-ops/tiers/?active=true') : Promise.resolve([]),
    ])
      .then(([meta, t]) => {
        if (cancelled) return
        setKinds(meta.document_kinds)
        setTiers(t)
      })
      .catch((err) => !cancelled && setLoadError(err.message))
    return () => {
      cancelled = true
    }
  }, [gymOn])

  async function createStudent(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await apiFetch('/students/', {
        method: 'POST',
        body: JSON.stringify({
          ...details,
          date_of_birth: details.date_of_birth || null,
          branch: details.branch === '' ? null : Number(details.branch),
          joined_on: today(),
        }),
      })
      setStudent(created)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function startMembership() {
    if (!tier) return
    setBusy(true)
    setError(null)
    try {
      const created = await apiFetch('/gym-ops/subscriptions/', {
        method: 'POST',
        body: JSON.stringify({ student: student.id, tier: tier.id, started_on: startedOn }),
      })
      setSubscription(created)
      setPayment((p) => ({ ...p, amount: String(created.amount_due ?? tier.price) }))
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function takePayment() {
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/billing/payments/', {
        method: 'POST',
        body: JSON.stringify({
          invoice: subscription.invoice,
          amount: payment.amount,
          paid_on: today(),
          method: payment.method,
          reference: payment.reference,
        }),
      })
      setPaid(true)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  function startOver() {
    setDetails({
      full_name: '', phone: '', email: '', date_of_birth: '',
      guardian_name: '', guardian_phone: '', branch: '',
    })
    setStudent(null)
    setPhotoDone(false)
    setDocumentDone(false)
    setTierId('')
    setStartedOn(today())
    setSubscription(null)
    setPayment({ amount: '', method: 'cash', reference: '' })
    setPaid(false)
    setError(null)
  }

  if (!canManage) {
    return <p className="muted">Onboarding is handled by owners and managers.</p>
  }
  if (loadError) return <p className="error">{loadError}</p>

  const endsOn = tier
    ? new Date(new Date(startedOn).getTime() + (tier.duration_days - 1) * 86400000)
        .toISOString().slice(0, 10)
    : null

  const requiresPayment = org?.membership_requires_payment !== false
  const live = paid || !requiresPayment
  // A gym's sign-up isn't finished until they're on a plan; everywhere else
  // the member record is the whole job.
  const done = gymOn ? !!subscription : !!student && documentDone

  return (
    <>
      <div className="row-actions">
        <button type="button" className="link" onClick={onClose}>← Members</button>
      </div>

      <h1>Sign up a member</h1>
      <p className="muted">
        {gymOn
          ? 'Details, photo, ID, plan, payment — in that order.'
          : 'Details, photo, ID.'}{' '}
        Each step saves as you go, so you can stop and come back.
      </p>

      {error && <p className="error">{error}</p>}

      <Step number={1} title="Who are they?" done={!!student} active={!student}>
        {student ? (
          <p className="muted small">
            <strong>{student.full_name}</strong>
            {student.phone && ` · ${student.phone}`}
            {student.branch_name && ` · ${student.branch_name}`}
          </p>
        ) : (
          <form onSubmit={createStudent}>
            <div className="two-up">
              <label>Full name
                <input required value={details.full_name}
                       onChange={(e) => setDetails({ ...details, full_name: e.target.value })} />
              </label>
              <label>Phone
                <input value={details.phone}
                       onChange={(e) => setDetails({ ...details, phone: e.target.value })} />
              </label>
            </div>
            <div className="two-up">
              <label>Email
                <input type="email" value={details.email}
                       onChange={(e) => setDetails({ ...details, email: e.target.value })} />
              </label>
              <label>Date of birth
                <input type="date" value={details.date_of_birth}
                       onChange={(e) => setDetails({ ...details, date_of_birth: e.target.value })} />
              </label>
            </div>
            <div className="two-up">
              <label>Guardian name
                <input value={details.guardian_name}
                       onChange={(e) => setDetails({ ...details, guardian_name: e.target.value })} />
              </label>
              <label>Guardian phone
                <input value={details.guardian_phone}
                       onChange={(e) => setDetails({ ...details, guardian_phone: e.target.value })} />
              </label>
            </div>
            {branches.length > 0 && (
              <label>Branch
                <select value={details.branch}
                        onChange={(e) => setDetails({ ...details, branch: e.target.value })}>
                  <option value="">No branch</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            <div className="row-actions">
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Next'}</button>
            </div>
          </form>
        )}
      </Step>

      <Step number={2} title="Photo" done={photoDone} active={!!student && !photoDone}
            hint="So whoever is on the desk can match the face to the name.">
        {!student ? (
          <p className="muted small">Fill in their details first.</p>
        ) : photoDone ? (
          <p className="muted small">Saved.</p>
        ) : (
          <PhotoStep student={student} onDone={() => setPhotoDone(true)}
                     onSkip={() => setPhotoDone(true)} />
        )}
      </Step>

      <Step number={3} title="ID proof" done={documentDone}
            active={photoDone && !documentDone}
            hint="Aadhaar, PAN, passport — whatever your academy asks for.">
        {!student ? (
          <p className="muted small">Fill in their details first.</p>
        ) : documentDone ? (
          <p className="muted small">Saved.</p>
        ) : (
          <DocumentStep student={student} kinds={kinds}
                        onDone={() => setDocumentDone(true)}
                        onSkip={() => setDocumentDone(true)} />
        )}
      </Step>

      {gymOn && (
      <Step number={4} title="Plan" done={!!subscription} active={!!student && !subscription}>
        {!student ? (
          <p className="muted small">Fill in their details first.</p>
        ) : subscription ? (
          <p className="muted small">
            <strong>{subscription.tier_name}</strong> · {subscription.started_on} to{' '}
            {subscription.expires_on} · ₹{money(subscription.price_paid)}
          </p>
        ) : tiers.length === 0 ? (
          <p className="muted small">
            No plans are switched on — create one under Membership Plans first.
          </p>
        ) : (
          <>
            <div className="set-entry">
              <label>Plan
                <select value={tierId} onChange={(e) => setTierId(e.target.value)}>
                  <option value="">Choose a plan…</option>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} — ₹{money(t.price)}</option>
                  ))}
                </select>
              </label>
              <label>Starts
                <input type="date" value={startedOn}
                       onChange={(e) => setStartedOn(e.target.value)} />
              </label>
            </div>
            {tier && (
              <p className="muted small">
                Runs {tier.duration_days} days — ends <strong>{endsOn}</strong>
              </p>
            )}
            <div className="row-actions">
              <button type="button" onClick={startMembership} disabled={!tier || busy}>
                {busy ? 'Saving…' : 'Start membership'}
              </button>
            </div>
          </>
        )}
      </Step>
      )}

      {gymOn && (
      <Step number={5} title="Payment" done={paid} active={!!subscription && !paid}>
        {!subscription ? (
          <p className="muted small">Put them on a plan first.</p>
        ) : paid ? (
          <p className="muted small">Recorded.</p>
        ) : (
          <>
            <p className="muted small">
              ₹{money(subscription.amount_due)} due.{' '}
              {requiresPayment
                ? 'The membership stays pending until some of this is paid.'
                : 'Your academy admits members before payment, so this can wait.'}
            </p>
            <div className="set-entry">
              <label>Amount
                <input type="number" step="0.01" min="0.01" value={payment.amount}
                       onChange={(e) => setPayment({ ...payment, amount: e.target.value })} />
              </label>
              <label>Method
                <select value={payment.method}
                        onChange={(e) => setPayment({ ...payment, method: e.target.value })}>
                  {PAYMENT_METHODS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>Reference
                <input value={payment.reference} placeholder="UPI ref, receipt no."
                       onChange={(e) => setPayment({ ...payment, reference: e.target.value })} />
              </label>
            </div>
            <div className="row-actions">
              <button type="button" onClick={takePayment} disabled={busy || !payment.amount}>
                {busy ? 'Saving…' : 'Record payment'}
              </button>
            </div>
          </>
        )}
      </Step>
      )}

      {done && (
        <div className={live ? 'card wide finished' : 'card wide'}>
          <h2>
            {!gymOn
              ? `${student.full_name} is on the roster`
              : live
                ? `${student.full_name} is a member`
                : `${student.full_name} is pending`}
          </h2>
          <p className="muted small">
            {!gymOn ? (
              <>They now appear under Members, and can be added to a batch.</>
            ) : live ? (
              <>
                Membership runs to <strong>{subscription.expires_on}</strong>. They show
                as <span className="pill active">active</span> on Memberships, and a
                reminder appears under Renewals five days before it ends.
              </>
            ) : (
              <>
                They are on <strong>{subscription.tier_name}</strong> but show as{' '}
                <span className="pill pending">pending</span> until a payment is
                recorded. You can take it here, on Memberships, or under Fees &amp;
                Billing — it is the same invoice everywhere.
              </>
            )}
          </p>
          <div className="row-actions">
            <button type="button" onClick={() => { onSaved?.(); onClose?.() }}>
              Back to Members
            </button>
            <button type="button" className="link" onClick={() => { onSaved?.(); startOver() }}>
              Sign up someone else
            </button>
          </div>
        </div>
      )}
    </>
  )
}
