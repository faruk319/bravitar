import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'

const PIPELINE = ['new', 'contacted', 'trial_scheduled', 'trial_done']
const LABEL = {
  new: 'New',
  contacted: 'Contacted',
  trial_scheduled: 'Trial scheduled',
  trial_done: 'Trial done',
  converted: 'Converted',
  lost: 'Lost',
}

export default function Enquiries() {
  const [funnel, setFunnel] = useState(null)
  const [enquiries, setEnquiries] = useState(null)
  const [status, setStatus] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('/enquiries/funnel/'),
      apiFetch(`/enquiries/${status ? `?status=${status}` : ''}`),
    ])
      .then(([f, e]) => {
        if (cancelled) return
        setFunnel(f)
        setEnquiries(e)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [status, refresh])

  async function advance(enquiry, nextStatus) {
    setError(null)
    try {
      await apiFetch(`/enquiries/${enquiry.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  async function convert(enquiry) {
    setBusyId(enquiry.id)
    setError(null)
    try {
      await apiFetch(`/enquiries/${enquiry.id}/convert/`, { method: 'POST' })
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusyId(null)
  }

  if (error && !funnel) return <p className="error">{error}</p>
  if (!funnel) return <p className="muted">Loading…</p>

  return (
    <>
      <h1>Enquiries</h1>
      <p className="muted">Every lead, from first contact to enrolment.</p>

      <div className="stat-row">
        <div className="stat-tile">
          <span className="muted small">Total enquiries</span>
          <div className="stat-value">{funnel.total}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Still open</span>
          <div className="stat-value">{funnel.open}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Converted</span>
          <div className="stat-value">{funnel.converted}</div>
        </div>
        <div className="stat-tile">
          <span className="muted small">Conversion rate</span>
          <div className="stat-value">
            {funnel.conversion_rate === null ? '—' : `${Math.round(funnel.conversion_rate * 100)}%`}
          </div>
        </div>
      </div>

      <div className="funnel">
        {PIPELINE.map((stage) => (
          <button
            key={stage}
            type="button"
            className={status === stage ? 'funnel-stage active' : 'funnel-stage'}
            onClick={() => setStatus(status === stage ? '' : stage)}
          >
            <span className="funnel-count">{funnel.by_status[stage] ?? 0}</span>
            <span className="muted small">{LABEL[stage]}</span>
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card wide">
        {enquiries === null ? (
          <p className="muted">Loading…</p>
        ) : enquiries.length === 0 ? (
          <p className="muted">No enquiries at this stage.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Phone</th><th>Source</th><th>Wants</th><th>Stage</th><th /></tr>
            </thead>
            <tbody>
              {enquiries.map((e) => {
                const index = PIPELINE.indexOf(e.status)
                const next = index >= 0 && index < PIPELINE.length - 1 ? PIPELINE[index + 1] : null
                return (
                  <tr key={e.id}>
                    <td>{e.name}</td>
                    <td>{e.phone || '—'}</td>
                    <td>{e.source}</td>
                    <td>{e.interested_in || '—'}</td>
                    <td><span className={`pill ${e.status}`}>{LABEL[e.status] ?? e.status}</span></td>
                    <td className="row-actions">
                      {next && (
                        <button type="button" className="link" onClick={() => advance(e, next)}>
                          → {LABEL[next]}
                        </button>
                      )}
                      {e.status !== 'converted' && e.status !== 'lost' && (
                        <button type="button" className="link" disabled={busyId === e.id}
                                onClick={() => convert(e)}>
                          {busyId === e.id ? 'Converting…' : 'Convert'}
                        </button>
                      )}
                      {e.converted_student_name && (
                        <span className="muted small">→ {e.converted_student_name}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
