import { useEffect, useMemo, useState } from 'react'

import { apiFetch } from '../lib/api'
import { BACK_MUSCLES, FRAME_SHAPES, FRONT_MUSCLES, VIEWBOX } from './muscleShapes'

// Sequential ramp: one hue, light to dark. Index 0 means "not trained".
const RAMP = ['#eceef1', '#d6e4fb', '#a9c7f4', '#6fa1ea', '#3b7ddd', '#1a5cc4']

const VIEWS = [
  {
    key: 'balance',
    label: 'Balance',
    legend: 'Share of training volume — dark means most of your work went here.',
    scaleLow: 'Untrained',
    scaleHigh: 'Most volume',
  },
  {
    key: 'fatigue',
    label: 'Fatigue',
    legend: 'How recently trained — dark means worked in the last day or two.',
    scaleLow: 'Rested',
    scaleHigh: 'Just trained',
  },
  {
    key: 'strength',
    label: 'Strength',
    legend: 'Best estimated 1RM reached — dark means your strongest lifts.',
    scaleLow: 'No lift',
    scaleHigh: 'Strongest',
  },
]

/** Maps a muscle's value for the active view onto a ramp index 0-5. */
function rampIndex(muscle, view, max) {
  if (view === 'fatigue') {
    const days = muscle.days_since
    if (days === null || days === undefined) return 0
    if (days <= 1) return 5
    if (days <= 3) return 4
    if (days <= 6) return 3
    if (days <= 10) return 2
    return 1
  }

  const value =
    view === 'strength' ? Number(muscle.best_estimated_1rm ?? 0) : Number(muscle.volume)
  if (!value || !max) return 0
  return Math.max(1, Math.ceil((value / max) * 5))
}

function Figure({ shapes, byMuscle, view, max, onHover }) {
  return Object.entries(shapes).flatMap(([muscle, list]) => {
    const data = byMuscle[muscle]
    const fill = RAMP[data ? rampIndex(data, view, max) : 0]

    return list.map((shape, index) => {
      const key = `${muscle}-${index}`
      const common = {
        fill,
        className: 'muscle-shape',
        onPointerEnter: () => onHover(data ?? { muscle, label: muscle }),
        onPointerLeave: () => onHover(null),
      }
      return shape.type === 'rect' ? (
        <rect
          key={key} {...common}
          x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx="4"
        />
      ) : (
        <ellipse key={key} {...common} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} />
      )
    })
  })
}

export default function MuscleMap() {
  const [data, setData] = useState(null)
  const [days, setDays] = useState(30)
  const [view, setView] = useState('balance')
  const [hovered, setHovered] = useState(null)
  const [showTable, setShowTable] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiFetch(`/gym/stats/muscles/?days=${days}`)
      .then((result) => !cancelled && setData(result))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [days])

  const byMuscle = useMemo(
    () => Object.fromEntries((data?.muscles ?? []).map((m) => [m.muscle, m])),
    [data],
  )

  const max = useMemo(() => {
    if (!data) return 0
    const values = data.muscles.map((m) =>
      view === 'strength' ? Number(m.best_estimated_1rm ?? 0) : Number(m.volume),
    )
    return Math.max(0, ...values)
  }, [data, view])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>

  const trained = data.muscles.filter((m) => Number(m.volume) > 0 || m.sets > 0)
  const activeView = VIEWS.find((v) => v.key === view)

  return (
    <>
      <h1>Muscle Map</h1>
      <p className="muted">Which muscles your training actually hit.</p>

      <div className="filters">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
        <select value={view} onChange={(e) => setView(e.target.value)}>
          {VIEWS.map((v) => (
            <option key={v.key} value={v.key}>{v.label}</option>
          ))}
        </select>
        <button type="button" className="link" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Show map' : 'Show table'}
        </button>
      </div>

      <div className="card wide">
        <p className="muted small">{activeView.legend}</p>

        {showTable ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Muscle</th><th>Volume</th><th>Share</th>
                <th>Sets</th><th>Best e1RM</th><th>Last trained</th>
              </tr>
            </thead>
            <tbody>
              {trained.length === 0 ? (
                <tr><td colSpan={6} className="muted">Nothing logged in this window.</td></tr>
              ) : (
                [...trained]
                  .sort((a, b) => Number(b.volume) - Number(a.volume))
                  .map((m) => (
                    <tr key={m.muscle}>
                      <td>{m.label}</td>
                      <td>{m.volume}</td>
                      <td>{(m.share * 100).toFixed(1)}%</td>
                      <td>{m.sets}</td>
                      <td>{m.best_estimated_1rm ?? '—'}</td>
                      <td>{m.days_since === null ? '—' : `${m.days_since}d ago`}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        ) : (
          <>
            <svg className="muscle-map" viewBox={VIEWBOX} role="img"
                 aria-label={`Muscle map, ${activeView.label} view`}>
              {FRAME_SHAPES.map((shape, i) => (
                <ellipse key={`frame-${i}`} cx={shape.cx} cy={shape.cy} rx={shape.rx}
                         ry={shape.ry} className="muscle-frame" />
              ))}
              <Figure shapes={FRONT_MUSCLES} byMuscle={byMuscle} view={view} max={max} onHover={setHovered} />
              <Figure shapes={BACK_MUSCLES} byMuscle={byMuscle} view={view} max={max} onHover={setHovered} />
              <text x="80" y="242" className="axis-text" textAnchor="middle">Front</text>
              <text x="240" y="242" className="axis-text" textAnchor="middle">Back</text>
            </svg>

            <div className="scale-legend">
              <span className="muted small">{activeView.scaleLow}</span>
              {RAMP.map((color) => (
                <span key={color} className="scale-step" style={{ background: color }} />
              ))}
              <span className="muted small">{activeView.scaleHigh}</span>
            </div>

            <p className="hover-readout">
              {hovered ? (
                <>
                  <strong>{hovered.label}</strong>
                  {hovered.volume !== undefined ? (
                    <span className="muted">
                      {' '}· {hovered.volume} volume · {(hovered.share * 100).toFixed(1)}% ·{' '}
                      {hovered.sets} sets ·{' '}
                      {hovered.days_since === null ? 'not trained' : `${hovered.days_since}d ago`}
                    </span>
                  ) : (
                    <span className="muted"> · not trained in this window</span>
                  )}
                </>
              ) : (
                <span className="muted">Hover a muscle for its numbers, or switch to the table.</span>
              )}
            </p>
          </>
        )}
      </div>
    </>
  )
}
