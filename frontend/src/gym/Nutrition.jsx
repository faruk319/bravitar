import { useEffect, useState } from 'react'

import { apiFetch, apiFetchAll, apiPage } from '../lib/api'
import MacroMeter from './MacroMeter'

const today = () => new Date().toISOString().slice(0, 10)

function TargetsForm({ plan, onSaved, onCancel }) {
  const [form, setForm] = useState({
    target_kcal: plan?.target_kcal ?? 2000,
    target_protein_g: plan?.target_protein_g ?? 150,
    target_carbs_g: plan?.target_carbs_g ?? 200,
    target_fat_g: plan?.target_fat_g ?? 60,
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/gym/nutrition/plan/', {
        method: 'PUT',
        body: JSON.stringify(form),
      })
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const field = (key, label, unit) => (
    <label>
      {label} ({unit})
      <input
        type="number" min="0" required
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  )

  return (
    <form className="set-entry" onSubmit={save}>
      {field('target_kcal', 'Calories', 'kcal')}
      {field('target_protein_g', 'Protein', 'g')}
      {field('target_carbs_g', 'Carbs', 'g')}
      {field('target_fat_g', 'Fat', 'g')}
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save targets'}</button>
      <button type="button" className="link" onClick={onCancel}>Cancel</button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

function AddFoodForm({ date, meals, onLogged }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [food, setFood] = useState(null)
  const [amount, setAmount] = useState('100')
  const [meal, setMeal] = useState('breakfast')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!search) return
    const timer = setTimeout(() => {
      apiPage(`/gym/nutrition/foods/?search=${encodeURIComponent(search)}`)
        .then((page) => setResults(page.items.slice(0, 8)))
        .catch((err) => setError(err.message))
    }, 200)
    return () => clearTimeout(timer)
  }, [search])

  async function log(event) {
    event.preventDefault()
    setError(null)
    try {
      await apiFetch('/gym/nutrition/log/', {
        method: 'POST',
        body: JSON.stringify({
          food_id: food.id,
          amount_g: amount,
          meal,
          consumed_on: date,
        }),
      })
      setFood(null)
      setSearch('')
      setAmount('100')
      onLogged()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="card wide">
      <h2>Add food</h2>

      {food ? (
        <form className="set-entry" onSubmit={log}>
          <span>
            <strong>{food.name}</strong>
            <span className="muted small"> · {food.energy_kcal} kcal / 100 g</span>
          </span>
          <label>
            Amount (g)
            <input
              type="number" min="1" step="1" required
              value={amount} onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Meal
            <select value={meal} onChange={(e) => setMeal(e.target.value)}>
              {meals.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <button type="submit">Log it</button>
          <button type="button" className="link" onClick={() => setFood(null)}>Change food</button>
        </form>
      ) : (
        <>
          <input
            type="search"
            placeholder="Search foods…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              if (!e.target.value) setResults([])
            }}
          />
          {results.length > 0 && (
            <ul className="search-results">
              {results.map((f) => (
                <li key={f.id}>
                  <button type="button" className="link" onClick={() => setFood(f)}>
                    {f.name}
                    <span className="muted small">
                      {' '}· {f.energy_kcal} kcal · P{f.protein_g} C{f.carbs_g} F{f.fat_g} /100g
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}

export default function Nutrition() {
  const [date, setDate] = useState(today)
  const [summary, setSummary] = useState(null)
  const [entries, setEntries] = useState(null)
  const [meals, setMeals] = useState([])
  const [editingTargets, setEditingTargets] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [error, setError] = useState(null)

  // Bumping the token re-runs the fetch; the cancelled flag means a fast date
  // change can't have its response land after a newer one.
  const reload = () => setRefreshToken((token) => token + 1)

  useEffect(() => {
    apiFetch('/gym/nutrition/meta/')
      .then((meta) => setMeals(meta.meals))
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch(`/gym/nutrition/summary/?date=${date}`),
      apiFetchAll(`/gym/nutrition/log/?date=${date}`),
    ])
      .then(([summaryData, entryData]) => {
        if (cancelled) return
        setSummary(summaryData)
        setEntries(entryData)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [date, refreshToken])

  if (error && !summary) return <p className="error">{error}</p>
  if (!summary) return <p className="muted">Loading…</p>

  const { totals, targets } = summary

  async function removeEntry(id) {
    await apiFetch(`/gym/nutrition/log/${id}/`, { method: 'DELETE' })
    reload()
  }

  return (
    <>
      <h1>Nutrition</h1>
      <p className="muted">What you ate, against your daily targets.</p>

      <div className="filters">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="button" className="link" onClick={() => setEditingTargets((v) => !v)}>
          {targets ? 'Edit targets' : 'Set targets'}
        </button>
      </div>

      <div className="stack wide">
        <div className="card wide">
          {editingTargets ? (
            <TargetsForm
              plan={targets}
              onCancel={() => setEditingTargets(false)}
              onSaved={() => {
                setEditingTargets(false)
                reload()
              }}
            />
          ) : targets ? (
            <div className="meter-grid">
              <MacroMeter label="Calories" value={totals.energy_kcal} target={targets.target_kcal} unit="kcal" />
              <MacroMeter label="Protein" value={totals.protein_g} target={targets.target_protein_g} unit="g" />
              <MacroMeter label="Carbs" value={totals.carbs_g} target={targets.target_carbs_g} unit="g" />
              <MacroMeter label="Fat" value={totals.fat_g} target={targets.target_fat_g} unit="g" />
            </div>
          ) : (
            <p className="muted">
              No targets yet — set them to track progress against a goal.
            </p>
          )}
        </div>

        <AddFoodForm date={date} meals={meals} onLogged={reload} />

        <div className="card wide">
          <h2>Today's food</h2>
          {entries === null ? (
            <p className="muted">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="muted">Nothing logged for this day.</p>
          ) : (
            meals.map((m) => {
              const forMeal = entries.filter((e) => e.meal === m.value)
              if (forMeal.length === 0) return null
              return (
                <div key={m.value}>
                  <h3 className="meal-heading">{m.label}</h3>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Food</th><th>Amount</th><th>kcal</th>
                        <th>P</th><th>C</th><th>F</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {forMeal.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.food.name}</td>
                          <td>{Math.round(entry.amount_g)} g</td>
                          <td>{entry.energy_kcal}</td>
                          <td>{entry.protein_g}</td>
                          <td>{entry.carbs_g}</td>
                          <td>{entry.fat_g}</td>
                          <td>
                            <button type="button" className="link" onClick={() => removeEntry(entry.id)}>
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
