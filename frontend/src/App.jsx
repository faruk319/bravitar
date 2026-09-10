import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/AuthContext'
import { isMemberPortal } from './lib/portal'
import { currentSlug } from './lib/tenant'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import MemberPortalPage from './pages/MemberPortalPage'
import RootPage from './pages/RootPage'

function Routes() {
  const { session, loading } = useAuth()

  if (loading) return <div className="centered"><p className="muted">Loading…</p></div>

  // Two doors. /member is the member's, everything else is the academy's, and
  // an account that belongs at the other one is sent there rather than let in.
  if (isMemberPortal()) {
    return session ? <MemberPortalPage /> : <LoginPage portal="member" />
  }

  if (!session) return <LoginPage portal="staff" />

  // Which page you get is decided by the host: an org subdomain shows that
  // org's dashboard, the root domain shows your academy list / onboarding.
  return currentSlug() ? <DashboardPage /> : <RootPage />
}

export default function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  )
}
