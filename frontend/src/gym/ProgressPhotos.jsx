import { useEffect, useState } from 'react'

import { apiFetchAll, apiObjectUrl, apiUpload } from '../lib/api'

function PhotoThumb({ photo }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let objectUrl = null
    let cancelled = false

    apiObjectUrl(`/gym/body/photos/${photo.id}/image/`)
      .then((created) => {
        objectUrl = created
        if (cancelled) URL.revokeObjectURL(created)
        else setUrl(created)
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photo.id])

  return (
    <figure className="photo">
      {url ? <img src={url} alt={`${photo.pose} on ${photo.taken_on}`} /> : <div className="photo-placeholder" />}
      <figcaption className="muted small">
        {photo.taken_on} · {photo.pose}
        {photo.notes && ` · ${photo.notes}`}
      </figcaption>
    </figure>
  )
}

export default function ProgressPhotos({ poses }) {
  const [photos, setPhotos] = useState(null)
  const [file, setFile] = useState(null)
  const [pose, setPose] = useState('front')
  const [takenOn, setTakenOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  function load() {
    apiFetchAll('/gym/body/photos/').then(setPhotos).catch((err) => setError(err.message))
  }

  useEffect(load, [])

  async function upload(event) {
    event.preventDefault()
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('image', file)
      form.append('pose', pose)
      form.append('taken_on', takenOn)
      form.append('notes', notes)
      await apiUpload('/gym/body/photos/', form)
      setFile(null)
      setNotes('')
      event.target.reset()
      load()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  return (
    <div className="card wide">
      <h2>Progress photos</h2>
      <p className="muted small">
        Private to you — trainers and other members can't see these.
      </p>

      <form className="photo-form" onSubmit={upload}>
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0] ?? null)} />
        <select value={pose} onChange={(e) => setPose(e.target.value)}>
          {poses.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <input type="date" value={takenOn} onChange={(e) => setTakenOn(e.target.value)} required />
        <input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button type="submit" disabled={busy || !file}>{busy ? 'Uploading…' : 'Upload'}</button>
      </form>

      {error && <p className="error">{error}</p>}

      {photos === null ? (
        <p className="muted">Loading…</p>
      ) : photos.length === 0 ? (
        <p className="muted">No photos yet.</p>
      ) : (
        <div className="photo-grid">
          {photos.map((photo) => (
            <PhotoThumb key={photo.id} photo={photo} />
          ))}
        </div>
      )}
    </div>
  )
}
