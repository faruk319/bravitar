import { useEffect, useMemo, useState } from 'react'

import { apiFetch } from '../lib/api'

// Sequential ramp, one hue light to dark. Index 0 = no training that day.
const RAMP = ['#eceef1', '#d6e4fb', '#a9c7f4', '#6fa1ea', '#3b7ddd', '#1a5cc4']

const CELL = 11
const GAP = 2
const DAY_LABELS = ['Mon', 'Wed', 'Fri']

const parseDay = (iso) => new Date(`${iso}T00:00:00`)
const formatDay = (iso) =>
  parseDay(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

function stepFor(sets) {
  if (!sets) return 0
  if (sets <= 3) return 1
  if (sets <= 6) return 2
  if (sets <= 10) return 3
  if (sets <= 15) return 4
  return 5
}

export default function ActivityHeatmap() {
  const [data, setData] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch('/gym/stats/activity/?days=365')
      .then(setData)
      .catch((err) => setError(err.message))
  }, [])

  const weeks = useMemo(() => {
    if (!data) return []
    const columns = []
    let current = []

    data.days.forEach((day, index) => {
      // JS weeks start Sunday; shift so Monday leads the column.
      const weekday = (parseDay(day.date).getDay() + 6) % 7
      if (index === 0) current = Array(weekday).fill(null)
      current.push(day)
      if (weekday === 6) {
        columns.push(current)
        current = []
      }
    })
    if (current.length) columns.push(current)
    return columns
  }, [data])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>

  const width = weeks.length * (CELL + GAP) + 30
  const height = 7 * (CELL + GAP) + 20
  const activeDays = data.days.filter((d) => d.sessions > 0).length

  return (
    <>
      <h1>Training Activity</h1>
      <p className="muted">Every day you trained in the last year.</p>

      <div className="card wide">
        <span className="muted small">
          {data.totals.sessions} sessions · {data.totals.sets} sets · {activeDays} active days
          in the last year
        </span>

        <div className="heatmap-scroll">
        <svg
          className="heatmap"
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: `${width}px` }}
          role="img"
          aria-label={`Training activity heatmap: ${activeDays} active days in the last year`}
        >
          {DAY_LABELS.map((label, i) => (
            <text key={label} x="0" y={(i * 2 + 1) * (CELL + GAP) + CELL - 1} className="axis-text">
              {label}
            </text>
          ))}

          {weeks.map((week, weekIndex) =>
            week.map((day, dayIndex) =>
              day === null ? null : (
                <rect
                  key={day.date}
                  x={30 + weekIndex * (CELL + GAP)}
                  y={dayIndex * (CELL + GAP)}
                  width={CELL}
                  height={CELL}
                  rx="2"
                  fill={RAMP[stepFor(day.sets)]}
                  className="heat-cell"
                  onPointerEnter={() => setHovered(day)}
                  onPointerLeave={() => setHovered(null)}
                />
              ),
            ),
          )}
        </svg>
      </div>

      <div className="scale-legend">
        <span className="muted small">Less</span>
        {RAMP.map((color) => (
          <span key={color} className="scale-step" style={{ background: color }} />
        ))}
        <span className="muted small">More</span>
      </div>

      <p className="hover-readout">
        {hovered ? (
          <>
            <strong>
              {hovered.sessions === 0
                ? 'Rest day'
                : `${hovered.sets} sets · ${hovered.sessions} session${hovered.sessions > 1 ? 's' : ''}`}
            </strong>
            <span className="muted"> · {formatDay(hovered.date)}</span>
          </>
        ) : (
          <span className="muted">Hover a day for its sessions and sets.</span>
        )}
        </p>
      </div>
    </>
  )
}
