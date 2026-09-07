import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/AuthContext'
import { currentSlug } from './lib/tenant'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import RootPage from './pages/RootPage'

function Routes() {
  const { session, loading } = useAuth()

  if (loading) return <div className="centered"><p className="muted">Loading…</p></div>
  if (!session) return <LoginPage />

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
