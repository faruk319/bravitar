import { useEffect, useState } from 'react'

import ConfirmAction from '../../components/ConfirmAction'
import { apiFetch, apiFetchAll, apiObjectUrl, apiUpload } from '../../lib/api'

/**
 * A member's proof-of-identity scans.
 *
 * Only rendered for owners and managers — the API refuses everyone else, and
 * showing a card that always errors would be worse than not showing it. The
 * scan itself is fetched on demand rather than with the list, so opening a
 * profile does not pull down everybody's Aadhaar.
 */
export default function DocumentsCard({ student, canManage }) {
  const [documents, setDocuments] = useState(null)
  const [kinds, setKinds] = useState([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ kind: 'aadhaar', number_last4: '', file: null })
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetchAll(`/students/documents/?student=${student.id}`),
      apiFetch('/students/meta/'),
    ])
      .then(([docs, meta]) => {
        if (cancelled) return
        setDocuments(docs)
        setKinds(meta.document_kinds)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [student.id, refresh])

  async function add(event) {
    event.preventDefault()
    if (!form.file) return
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('student', student.id)
      body.append('kind', form.kind)
      body.append('number_last4', form.number_last4)
      body.append('file', form.file)
      await apiUpload('/students/documents/', body)
      setForm({ kind: 'aadhaar', number_last4: '', file: null })
      setAdding(false)
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function act(path, method) {
    await apiFetch(path, { method })
    setRefresh((n) => n + 1)
  }

  async function view(document) {
    setError(null)
    try {
      const url = await apiObjectUrl(`/students/documents/${document.id}/file/`)
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="card wide">
      <div className="row">
        <h2>ID proof</h2>
        {canManage && !adding && (
          <button type="button" className="link" onClick={() => setAdding(true)}>
            + Add
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {documents === null ? (
        <p className="muted">Loading…</p>
      ) : documents.length === 0 ? (
        <p className="muted">Nothing on file.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Document</th><th>Number</th><th>Added</th><th>Checked</th>{canManage && <th />}</tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.kind_label}</td>
                <td>{doc.number_last4 ? `•••• ${doc.number_last4}` : '—'}</td>
                <td>{doc.created_at?.slice(0, 10)}</td>
                <td>
                  {doc.is_verified
                    ? <span className="pill paid">verified {doc.verified_on}</span>
                    : <span className="pill pending">not checked</span>}
                </td>
                {canManage && (
                  <td>
                    <div className="row-actions">
                      <button type="button" className="link" onClick={() => view(doc)}>
                        View
                      </button>
                      {!doc.is_verified && (
                        <button type="button" className="link"
                                onClick={() => act(`/students/documents/${doc.id}/verify/`, 'POST')
                            .catch((err) => setError(err.message))}>
                          Mark checked
                        </button>
                      )}
                      <ConfirmAction
                        label="Delete"
                        heading={`Delete this ${doc.kind_label}?`}
                        detail="The scan is removed for good. You would have to ask the member for it again."
                        confirmLabel="Yes, delete it"
                        onConfirm={() => act(`/students/documents/${doc.id}/`, 'DELETE')}
                      />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canManage && adding && (
        <form className="set-entry" onSubmit={add}>
          <label>Document
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label>Last 4 digits
            <input value={form.number_last4} maxLength={4} inputMode="numeric" placeholder="4321"
                   onChange={(e) => setForm({ ...form, number_last4: e.target.value })} />
          </label>
          <label className="file-pick-block">Scan
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                   onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} />
          </label>
          <button type="submit" disabled={!form.file || busy}>
            {busy ? 'Uploading…' : 'Save'}
          </button>
          <button type="button" className="link" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}

    </div>
  )
}
