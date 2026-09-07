import { useEffect, useState } from 'react'

import CreateOrgForm from '../components/CreateOrgForm'
import { useAuth } from '../auth/AuthContext'
import { apiFetchAll } from '../lib/api'
import { orgUrl } from '../lib/tenant'
import { verticalLabel } from '../lib/verticals'

/**
 * Served on the root domain. Sends you to your academy's subdomain, or walks
 * you through creating one if you don't have any yet.
 */
export default function RootPage() {
  const { user, signOut } = useAuth()
  const [memberships, setMemberships] = useState(null)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    apiFetchAll('/organizations/mine/')
      .then(setMemberships)
      .catch((err) => setError(err.message))
  }, [])

  if (error) return <div className="centered"><p className="error">{error}</p></div>
  if (memberships === null) return <div className="centered"><p className="muted">Loading…</p></div>

  const showForm = creating || memberships.length === 0

  return (
    <div className="centered">
      <div className="stack">
        <header className="row">
          <span className="muted small">Signed in as {user?.email}</span>
          <button type="button" className="link" onClick={signOut}>Sign out</button>
        </header>

        {memberships.length > 0 && (
          <div className="card">
            <h2>Your academies</h2>
            <ul className="org-list">
              {memberships.map(({ organization, role }) => (
                <li key={organization.id}>
                  <a href={orgUrl(organization.slug)}>
                    <strong>{organization.name}</strong>
                    <span className="muted small">
                      {organization.verticals.map(verticalLabel).join(', ')} · {role}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            {!creating && (
              <button type="button" className="link" onClick={() => setCreating(true)}>
                + Create another academy
              </button>
            )}
          </div>
        )}

        {showForm && <CreateOrgForm />}
      </div>
    </div>
  )
}
