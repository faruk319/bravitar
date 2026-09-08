import { useEffect, useState } from 'react'

import ConfirmAction from '../../components/ConfirmAction'
import { apiFetch, apiObjectUrl, apiUpload } from '../../lib/api'

/** A member's photo, on their own profile: view, replace, remove. */
export default function PhotoCard({ student, canEdit, onChanged }) {
  const [url, setUrl] = useState(null)
  const [missing, setMissing] = useState(!student.has_photo)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!student.has_photo) {
      setMissing(true)
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
        setMissing(false)
      })
      .catch(() => !cancelled && setMissing(true))
    // The blob stays in memory until it is released, and this card is
    // re-mounted every time you open a different member.
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [student.id, student.has_photo])

  async function replace(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('photo', file)
      await apiUpload(`/students/${student.id}/photo/`, form, 'PUT')
      onChanged()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function remove() {
    await apiFetch(`/students/${student.id}/photo/`, { method: 'DELETE' })
    setUrl(null)
    setMissing(true)
    onChanged()
  }

  return (
    <div className="card wide">
      <h2>Photo</h2>
      {error && <p className="error">{error}</p>}

      <div className="photo-capture">
        {url ? (
          <img src={url} alt="" className="photo-preview" />
        ) : (
          <div className="photo-preview empty">{missing ? 'No photo' : 'Loading…'}</div>
        )}

        {canEdit && (
          <div className="row-actions">
            <label className="link file-pick">
              {missing ? 'Add a photo' : 'Replace'}
              <input type="file" accept="image/jpeg,image/png,image/webp"
                     disabled={busy} onChange={replace} />
            </label>
            {!missing && (
              <ConfirmAction
                label="Remove"
                disabled={busy}
                heading="Remove this photo?"
                detail="The desk loses the face that goes with this name. You can add another later."
                confirmLabel="Yes, remove it"
                onConfirm={remove}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
