import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll } from '../lib/api'
import MeasurementChart from './MeasurementChart'
import ProgressPhotos from './ProgressPhotos'

export default function BodyLog() {
  const [meta, setMeta] = useState(null)
  const [metric, setMetric] = useState('weight')
  const [entries, setEntries] = useState(null)
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('kg')
  const [measuredOn, setMeasuredOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiFetch('/gym/body/meta/').then(setMeta).catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    let cancelled = false
    apiFetchAll(`/gym/body/entries/?metric=${metric}`)
      .then((data) => !cancelled && setEntries(data))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [metric])

  const metricMeta = meta?.metrics.find((m) => m.value === metric)
  // Derived, not stored: a waist reading can't be in kg, and the API rejects it.
  const effectiveUnit =
    metricMeta && !metricMeta.units.includes(unit) ? metricMeta.default_unit : unit

  async function logReading(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/gym/body/entries/', {
        method: 'POST',
        body: JSON.stringify({ metric, value, unit: effectiveUnit, measured_on: measuredOn }),
      })
      setValue('')
      setEntries(await apiFetchAll(`/gym/body/entries/?metric=${metric}`))
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  if (error && !meta) return <p className="error">{error}</p>
  if (!meta) return <p className="muted">Loading…</p>

  return (
    <>
      <h1>Body &amp; Progress</h1>
      <p className="muted">Measurements and photos, private to you.</p>

      <div className="filters">
        <select
          value={metric}
          onChange={(e) => {
            setEntries(null)
            setMetric(e.target.value)
          }}
        >
          {meta.metrics.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="stack wide">
        <div className="card wide">
          {entries === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <MeasurementChart
              entries={entries}
              label={metricMeta?.label ?? metric}
              unit={entries[0]?.unit ?? metricMeta?.default_unit ?? ''}
            />
          )}

          <form className="set-entry" onSubmit={logReading}>
            <label>
              {metricMeta?.label}
              <input
                type="number" step="0.1" required
                value={value} onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <label>
              Unit
              <select value={effectiveUnit} onChange={(e) => setUnit(e.target.value)}>
                {(metricMeta?.units ?? []).map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input
                type="date" required
                value={measuredOn} onChange={(e) => setMeasuredOn(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy || value === ''}>
              {busy ? 'Saving…' : 'Log reading'}
            </button>
          </form>

          {error && <p className="error">{error}</p>}
        </div>

        <ProgressPhotos poses={meta.poses} />
      </div>
    </>
  )
}
