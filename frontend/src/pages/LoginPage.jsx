import { useState } from 'react'

import { memberPortalUrl, staffPortalUrl } from '../lib/portal'
import { supabase } from '../lib/supabase'

/** One screen, two doors. Which one you are at decides who it is for and
 *  where the other one is — nobody is left guessing why their password
 *  "doesn't work" when it is simply the wrong entrance. */
export default function LoginPage({ portal = 'staff' }) {
  const member = portal === 'member'
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const { error: authError } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    if (authError) setError(authError.message)
    setBusy(false)
  }

  return (
    <div className="centered">
      <form className="card" onSubmit={handleSubmit}>
        <h1>Bravitar</h1>
        <p className="muted">
          {member ? 'Member sign in' : 'Staff sign in'}
          {mode === 'signup' && ' — create your account'}
        </p>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>

        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
          }}
        >
          {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
        </button>

        <p className="muted small">
          {member ? 'Run this academy? ' : 'Are you a member? '}
          <a href={member ? staffPortalUrl() : memberPortalUrl()}>
            {member ? 'Staff sign in' : 'Member sign in'}
          </a>
        </p>
      </form>
    </div>
  )
}
