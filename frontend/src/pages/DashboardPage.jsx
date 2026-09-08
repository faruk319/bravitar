import { useEffect, useState } from 'react'

import ApiKeys from '../admin/ApiKeys'
import Branches from '../admin/Branches'
import Settings from '../admin/Settings'
import Team from '../admin/Team'
import { useAuth } from '../auth/AuthContext'
import { apiFetch, apiFetchAll } from '../lib/api'
import { MODULE_COMPONENTS } from '../lib/moduleRegistry'
import AcademyPicker from '../components/AcademyPicker'
import { currentAcademy } from '../lib/academy'
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
        return apiFetchAll('/organizations/current/branches/').then(setBranches).catch(() => {})
      })
      .catch((err) => setError(err.message))
  }, [])

  if (error) {
    return (
      <div className="centered">
        <div className="card">
          <p className="error">{error}</p>
          <a href={rootUrl()}>Back to your organizations</a>
        </div>
      </div>
    )
  }

  if (!org) return <div className="centered"><p className="muted">Loading…</p></div>

  // Several academies and none chosen: there is nothing to show until the
  // owner says which, so ask rather than guessing one.
  if (org.viewing === 'none') {
    return (
      <div className="centered">
        <div className="card">
          <h2>{org.organization?.name}</h2>
          <p className="muted">
            This organization runs {org.academies?.length} academies. Choose
            which one you&apos;re working in.
          </p>
          <AcademyPicker
            academies={org.academies ?? []}
            current={currentAcademy()}
            maySeeAll={org.may_see_all_academies}
          />
          <p className="muted small">
            <a href={rootUrl()}>Switch organization</a>
          </p>
        </div>
      </div>
    )
  }

  const modules = modulesForVerticals(org.verticals)
  const activeModule = modules.find((m) => m.key === active)
  const ModuleComponent = activeModule ? MODULE_COMPONENTS[activeModule.key] : null

  // Admin lives outside the vertical modules: it's about the academy itself,
  // not what it teaches. Staff can see the team; only an owner sees settings.
  // The backend enforces this regardless of what the sidebar shows.
  const adminItems = [
    ...(['owner', 'manager', 'staff'].includes(org.role)
      ? [{ key: 'team', label: 'Team' }, { key: 'branches', label: 'Branches' }]
      : []),
    ...(org.role === 'owner'
      ? [{ key: 'settings', label: 'Settings' }, { key: 'apikeys', label: 'API Keys' }]
      : []),
  ]
  const activeAdmin = adminItems.find((item) => item.key === active)

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

        {adminItems.length > 0 && (
          <nav>
            <span className="nav-heading">Academy</span>
            {adminItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === active ? 'nav-item active' : 'nav-item'}
                onClick={() => setActive(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        )}

        <div className="sidebar-footer">
          <span className="muted small">{user?.email}</span>
          <button type="button" className="link" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className="content">
        <AcademyPicker
          academies={org.academies ?? []}
          current={currentAcademy()}
          maySeeAll={org.may_see_all_academies}
        />

        {activeAdmin ? (
          activeAdmin.key === 'team' ? (
            <Team role={org.role} />
          ) : activeAdmin.key === 'branches' ? (
            <Branches role={org.role} org={org} />
          ) : activeAdmin.key === 'apikeys' ? (
            <ApiKeys org={org} />
          ) : (
            <Settings org={org} role={org.role} onOrgChange={setOrg} />
          )
        ) : activeModule ? (
          ModuleComponent ? (
            <ModuleComponent role={org.role} org={org} />
          ) : (
            <>
              <h1>{activeModule.label}</h1>
              <p className="muted">
                This module is not built yet — it arrives in a later phase.
              </p>
            </>
          )
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
