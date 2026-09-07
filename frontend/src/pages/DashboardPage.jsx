import { useEffect, useState } from 'react'

import { useAuth } from '../auth/AuthContext'
import { apiFetch } from '../lib/api'
import { rootUrl } from '../lib/tenant'
import { modulesForVerticals, verticalLabel } from '../lib/verticals'

/**
 * Served on <slug>.<base domain>. The organization comes from the backend's
 * tenant middleware resolving the Host header — the frontend never sends an
 * org id. Which modules appear is driven by the org's selected verticals.
 */
export default function DashboardPage() {
  const { user, signOut } = useAuth()
  const [org, setOrg] = useState(null)
  const [branches, setBranches] = useState([])
  const [error, setError] = useState(null)
  const [active, setActive] = useState(null)

  useEffect(() => {
    apiFetch('/organizations/current/')
      .then((data) => {
        setOrg(data)
        return apiFetch('/organizations/current/branches/').then(setBranches).catch(() => {})
      })
      .catch((err) => setError(err.message))
  }, [])

  if (error) {
    return (
      <div className="centered">
        <div className="card">
          <p className="error">{error}</p>
          <a href={rootUrl()}>Back to your academies</a>
        </div>
      </div>
    )
  }

  if (!org) return <div className="centered"><p className="muted">Loading…</p></div>

  const modules = modulesForVerticals(org.verticals)
  const activeModule = modules.find((m) => m.key === active)

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <strong>{org.name}</strong>
          <span className="muted small">{org.verticals.map(verticalLabel).join(', ')}</span>
        </div>

        <nav>
          {modules.map((module) => (
            <button
              key={module.key}
              type="button"
              className={module.key === active ? 'nav-item active' : 'nav-item'}
              onClick={() => setActive(module.key)}
            >
              {module.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="muted small">{user?.email}</span>
          <button type="button" className="link" onClick={signOut}>Sign out</button>
          <a className="small" href={rootUrl()}>Switch academy</a>
        </div>
      </aside>

      <main className="content">
        {activeModule ? (
          <>
            <h1>{activeModule.label}</h1>
            <p className="muted">
              This module is not built yet — it arrives in a later phase.
            </p>
          </>
        ) : (
          <>
            <h1>Dashboard</h1>
            <p className="muted">
              {org.plan} plan · {branches.length} branch{branches.length === 1 ? '' : 'es'}
            </p>
            <div className="tiles">
              {modules.map((module) => (
                <button
                  key={module.key}
                  type="button"
                  className="tile"
                  onClick={() => setActive(module.key)}
                >
                  {module.label}
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
