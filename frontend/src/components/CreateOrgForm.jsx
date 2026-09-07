import { useState } from 'react'

import { apiFetch } from '../lib/api'
import { orgUrl } from '../lib/tenant'
import { SELECTABLE_VERTICALS } from '../lib/verticals'

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function CreateOrgForm() {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [verticals, setVerticals] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  function handleNameChange(value) {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  function toggleVertical(value) {
    setVerticals((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    )
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (verticals.length === 0) {
      setError('Pick at least one business type.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const org = await apiFetch('/organizations/signup/', {
        method: 'POST',
        body: JSON.stringify({ name, slug, verticals }),
      })
      // Hop to the org's own subdomain — that's what scopes every later request.
      window.location.href = orgUrl(org.slug)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>Set up your academy</h2>

      <label>
        Academy name
        <input value={name} onChange={(e) => handleNameChange(e.target.value)} required />
      </label>

      <label>
        Web address
        <input
          value={slug}
          onChange={(e) => {
            setSlugTouched(true)
            setSlug(slugify(e.target.value))
          }}
          required
          pattern="[a-z0-9-]+"
        />
        <span className="muted small">{slug || 'your-academy'}.bravitar.com</span>
      </label>

      <fieldset>
        <legend>What kind of business is it?</legend>
        <p className="muted small">
          This decides which modules you get. You can add more later.
        </p>
        <div className="vertical-grid">
          {SELECTABLE_VERTICALS.map((vertical) => (
            <label key={vertical.value} className="checkbox stacked">
              <span>
                <input
                  type="checkbox"
                  checked={verticals.includes(vertical.value)}
                  onChange={() => toggleVertical(vertical.value)}
                />
                {vertical.label}
              </span>
              {vertical.description && (
                <span className="muted small">{vertical.description}</span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create academy'}
      </button>
    </form>
  )
}
