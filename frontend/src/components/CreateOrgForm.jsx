import { useState } from 'react'

import { apiFetch } from '../lib/api'
import { orgUrl } from '../lib/tenant'
import { SELECTABLE_VERTICALS } from '../lib/verticals'

/**
 * Two steps on purpose: the organization is the business, the academy is what
 * it runs. Asking for both names on one screen is what made people think they
 * were the same thing.
 */

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function CreateOrgForm() {
  const [step, setStep] = useState(1)
  const [orgName, setOrgName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [academyName, setAcademyName] = useState('')
  const [verticals, setVerticals] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  function handleOrgName(value) {
    setOrgName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  function toggleVertical(value) {
    setVerticals((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    )
  }

  function goToStepTwo(event) {
    event.preventDefault()
    setError(null)
    // Most businesses run one academy under their own name, so offer it.
    if (!academyName) setAcademyName(orgName)
    setStep(2)
  }

  async function create(event) {
    event.preventDefault()
    if (verticals.length === 0) {
      setError('Pick at least one sport.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const created = await apiFetch('/organizations/signup/', {
        method: 'POST',
        body: JSON.stringify({
          name: orgName,
          slug,
          academy_name: academyName,
          verticals,
        }),
      })
      // Hop to the organization's own subdomain — that's what scopes every
      // later request.
      window.location.href = orgUrl(created.organization_slug ?? slug)
    } catch (err) {
      setError(err.message)
      setBusy(false)
      setStep(1)
    }
  }

  if (step === 1) {
    return (
      <form className="card" onSubmit={goToStepTwo}>
        <span className="muted small">Step 1 of 2</span>
        <h2>Your organization</h2>
        <p className="muted small">
          The business itself. Everything you run sits under it, and it owns
          your web address.
        </p>

        <label>
          Name
          <input value={orgName} onChange={(e) => handleOrgName(e.target.value)}
                 placeholder="Bravitar Fitness" required />
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
          <span className="muted small">{slug || 'your-business'}.bravitar.com</span>
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={!orgName || !slug}>Next</button>
      </form>
    )
  }

  return (
    <form className="card" onSubmit={create}>
      <span className="muted small">Step 2 of 2</span>
      <h2>Your first academy</h2>
      <p className="muted small">
        What {orgName} actually runs. You can add more academies later — a gym
        and a swim school under the same business are two academies.
      </p>

      <label>
        Academy name
        <input value={academyName} onChange={(e) => setAcademyName(e.target.value)}
               placeholder="Iron Temple Gym" required />
      </label>

      <fieldset>
        <legend>What does it run?</legend>
        <p className="muted small">
          This decides which modules you get. You can change it later.
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

      <div className="row-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create organization'}
        </button>
        <button type="button" className="link" onClick={() => setStep(1)}>Back</button>
      </div>
    </form>
  )
}
