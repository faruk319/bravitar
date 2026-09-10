import { useEffect, useState } from 'react'

import ApiKeys from '../admin/ApiKeys'
import Branches from '../admin/Branches'
import Settings from '../admin/Settings'
import Team from '../admin/Team'
import { useAuth } from '../auth/AuthContext'
import { apiFetch, apiFetchAll } from '../lib/api'
import { MODULE_COMPONENTS } from '../lib/moduleRegistry'
import AcademyPicker from '../components/AcademyPicker'
import WrongDoor from '../components/WrongDoor'
import { currentAcademy } from '../lib/academy'
import { memberPortalUrl } from '../lib/portal'
import { rootUrl } from '../lib/tenant'
import { moduleGroups, modulesForVerticals, verticalLabel } from '../lib/verticals'

/**
 * Served on <slug>.<base domain>. The organization comes from the backend's
 * tenant middleware resolving the Host header — the frontend never sends an
 * org id. Which modules appear is driven by the org's selected verticals.
 */
export default function DashboardPage() {
  const { user, signOut } = useAuth()
  const [org, setOrg] = useState(null)
  const [branches, setBranches] = useState([])
  const [isMember, setIsMember] = useState(false)
  const [error, setError] = useState(null)
  // Which module is open lives in the URL hash, so a refresh lands where you
  // were and back/forward work. No router needed — the app is one page.
  const [active, setActive] = useState(() => window.location.hash.slice(1) || null)
  // Null means "whichever group holds the open module" — only set when the
  // user opens a group without picking anything in it yet.
  const [openGroup, setOpenGroup] = useState(null)

  useEffect(() => {
    const sync = () => setActive(window.location.hash.slice(1) || null)
    // popstate too: going home pushes a plain path, not a hash.
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  const show = (key) => {
    if (key) window.location.hash = key
    else window.history.pushState(null, '', window.location.pathname)
    setActive(key ?? null)
    setOpenGroup(null)
  }

  // A member has no Membership, so this call is the wrong question for them.
  // They are sent to their own door rather than let in through this one.
  useEffect(() => {
    apiFetch('/organizations/current/')
      .then((data) => {
        setOrg(data)
        return apiFetchAll('/organizations/current/branches/').then(setBranches).catch(() => {})
      })
      .catch((err) =>
        apiFetch('/member/')
          .then(() => setIsMember(true))
          .catch(() => setError(err.message)),
      )
  }, [])

  if (isMember) {
    return (
      <WrongDoor
        heading="This is the staff sign in"
        detail="That account is a member here, not somebody who runs the academy."
        href={memberPortalUrl()}
        linkLabel="Go to member sign in"
        onSignOut={signOut}
      />
    )
  }

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

  const groups = moduleGroups(org.verticals)
  const modules = modulesForVerticals(org.verticals)
  const activeModule = modules.find((m) => m.key === active)
  const ModuleComponent = activeModule ? MODULE_COMPONENTS[activeModule.key] : null

  // One group open at a time. It follows the open module unless the user has
  // just reached past it into another group.
  const groupOf = (key) => groups.find((g) => g.modules.some((m) => m.key === key))?.key
  const expandedGroup = openGroup ?? groupOf(active) ?? groups[0].key

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
        <button type="button" className="brand" onClick={() => show(null)}>
          <strong>{org.name}</strong>
          <span className="muted small">{org.verticals.map(verticalLabel).join(', ')}</span>
        </button>

        <nav>
          {groups.map((group) => {
            const open = group.key === expandedGroup
            const holdsActive = groupOf(active) === group.key
            return (
              <div key={group.key} className="nav-group">
                <button
                  type="button"
                  className={holdsActive ? 'nav-group-head on' : 'nav-group-head'}
                  onClick={() => setOpenGroup(open ? '' : group.key)}
                  aria-expanded={open}
                >
                  {group.label}
                  <span className="nav-chevron">{open ? '▾' : '▸'}</span>
                </button>
                {open && group.modules.map((module) => (
                  <button
                    key={module.key}
                    type="button"
                    className={module.key === active ? 'nav-item active' : 'nav-item'}
                    onClick={() => show(module.key)}
                  >
                    {module.label}
                  </button>
                ))}
              </div>
            )
          })}
        </nav>

        {adminItems.length > 0 && (
          <nav>
            <span className="nav-heading">Academy</span>
            {adminItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === active ? 'nav-item active' : 'nav-item'}
                onClick={() => show(item.key)}
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
            {groups.map((group) => (
              <section key={group.key} className="module-group">
                <span className="nav-heading">{group.label}</span>
                <div className="tiles">
                  {group.modules.map((module) => (
                    <button
                      key={module.key}
                      type="button"
                      className="tile"
                      onClick={() => show(module.key)}
                    >
                      {module.label}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  )
}
