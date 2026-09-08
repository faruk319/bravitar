import { useEffect, useState } from 'react'

import ConfirmAction from '../components/ConfirmAction'
import { apiFetch, apiFetchAll } from '../lib/api'
import { orgUrl } from '../lib/tenant'

/**
 * API keys for headless access: a customer's own app talking straight to
 * Bravitar instead of using this frontend.
 *
 * The secret is shown once, at creation, and never again — only its hash is
 * stored. That makes the moment it appears the whole design problem, so it
 * gets its own panel that doesn't go away until dismissed.
 */

function NewKeyReveal({ created, onDone }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.key)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="card wide reveal">
      <h2>Copy this key now</h2>
      <p className="muted small">
        This is the only time it is shown. Only a hash of it is stored, so it
        cannot be recovered — if you lose it, revoke it and make another.
      </p>

      <code className="secret">{created.key}</code>

      <div className="row-actions">
        <button type="button" onClick={copy}>{copied ? 'Copied ✓' : 'Copy key'}</button>
        <button type="button" className="link" onClick={onDone}>
          I've saved it
        </button>
      </div>
    </div>
  )
}

function Usage({ slug }) {
  const host = orgUrl(slug).replace(/\/$/, '')
  return (
    <div className="card wide">
      <h2>Using a key</h2>
      <p className="muted small">
        Send it as an <code>X-API-Key</code> header. The key decides which
        academy the request belongs to, so you don't pass an organization id.
      </p>
      <pre className="snippet">{`curl ${host}/api/students/ \\
  -H "X-API-Key: bvt_your_key_here"`}</pre>
      <p className="muted small">
        A key carries the academy's access, not a person's — treat it like a
        password and keep it out of anything public.
      </p>
    </div>
  )
}

export default function ApiKeys({ org }) {
  const [keys, setKeys] = useState(null)
  const [created, setCreated] = useState(null)
  const [name, setName] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiFetchAll('/organizations/current/api-keys/')
      .then((data) => !cancelled && setKeys(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function create(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const key = await apiFetch('/organizations/current/api-keys/', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      setCreated(key)
      setName('')
      setRefresh((n) => n + 1)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  async function revoke(key) {
    await apiFetch(`/organizations/current/api-keys/${key.id}/revoke/`, { method: 'POST' })
    setRefresh((n) => n + 1)
  }

  const active = (keys ?? []).filter((k) => k.is_active)

  return (
    <>
      <h1>API Keys</h1>
      <p className="muted">
        For building your own app or website against this academy's data.
      </p>

      {error && <p className="error">{error}</p>}

      {created && <NewKeyReveal created={created} onDone={() => setCreated(null)} />}

      <form className="card wide" onSubmit={create}>
        <h2>Create a key</h2>
        <div className="set-entry">
          <label>
            What is it for?
            <input
              required value={name} placeholder="Members app"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create key'}</button>
        </div>
        <p className="muted small">
          Naming keys by what uses them is what makes revoking one safe later.
        </p>
      </form>

      <div className="card wide">
        <div className="row">
          <h2>Keys</h2>
          <span className="muted small">
            {active.length} active{keys && keys.length > active.length
              ? ` · ${keys.length - active.length} revoked`
              : ''}
          </span>
        </div>

        {keys === null ? (
          <p className="muted">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="muted">No keys yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className={key.is_active ? '' : 'revoked-row'}>
                  <td>{key.name || '—'}</td>
                  <td><code>{key.prefix}…</code></td>
                  <td>{key.created_at.slice(0, 10)}</td>
                  <td>{key.last_used_at ? key.last_used_at.slice(0, 10) : 'never'}</td>
                  <td>
                    <span className={key.is_active ? 'pill active' : 'pill left'}>
                      {key.is_active ? 'active' : 'revoked'}
                    </span>
                  </td>
                  <td>
                    {key.is_active && (
                      <ConfirmAction
                        label="Revoke"
                        heading={`Revoke ${key.name}?`}
                        detail="Anything using this key stops working immediately, and it can't be switched back on."
                        confirmLabel="Yes, revoke"
                        onConfirm={() => revoke(key)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Usage slug={org.slug} />
    </>
  )
}
