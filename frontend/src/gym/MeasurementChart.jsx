import { useMemo, useState } from 'react'

const PAD = { top: 16, right: 52, bottom: 30, left: 44 }
const WIDTH = 640
const PLOT_HEIGHT = 200
// Container height includes the x-axis band, so axis labels are never clipped.
const HEIGHT = PLOT_HEIGHT + PAD.top + PAD.bottom

const SERIES_COLOR = '#1f6feb'

function niceTicks(min, max, count = 4) {
  if (min === max) return [min]
  const rawStep = (max - min) / count
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10
  const start = Math.floor(min / step) * step
  const ticks = []
  for (let value = start; value <= max + step / 2; value += step) ticks.push(Number(value.toFixed(6)))
  return ticks.filter((t) => t >= min - step && t <= max + step)
}

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * Change-over-time for one body metric. Deliberately one metric at a time —
 * plotting weight and waist together would need two y-scales, which invents a
 * correlation that isn't in the data.
 */
export default function MeasurementChart({ entries, label, unit }) {
  const [hoverIndex, setHoverIndex] = useState(null)
  const [showTable, setShowTable] = useState(false)

  const points = useMemo(() => {
    if (entries.length === 0) return []
    const values = entries.map((e) => Number(e.value))
    const times = entries.map((e) => new Date(`${e.measured_on}T00:00:00`).getTime())

    const minValue = Math.min(...values)
    const maxValue = Math.max(...values)
    const span = maxValue - minValue || 1
    const padded = { lo: minValue - span * 0.15, hi: maxValue + span * 0.15 }

    const minTime = Math.min(...times)
    const maxTime = Math.max(...times)
    const timeSpan = maxTime - minTime || 1

    return entries.map((entry, i) => ({
      ...entry,
      numeric: values[i],
      x: PAD.left + ((times[i] - minTime) / timeSpan) * (WIDTH - PAD.left - PAD.right),
      y: PAD.top + (1 - (values[i] - padded.lo) / (padded.hi - padded.lo)) * PLOT_HEIGHT,
      lo: padded.lo,
      hi: padded.hi,
    }))
  }, [entries])

  if (entries.length === 0) {
    return <p className="muted">No readings yet — log one to start the chart.</p>
  }

  const { lo, hi } = points[0]
  const ticks = niceTicks(lo, hi)
  const yFor = (value) => PAD.top + (1 - (value - lo) / (hi - lo)) * PLOT_HEIGHT

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const last = points[points.length - 1]
  const first = points[0]
  const change = last.numeric - first.numeric
  const active = hoverIndex === null ? null : points[hoverIndex]

  function handleMove(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH
    // Nearest point on X, so the reader aims at a date rather than a 2px line.
    let nearest = 0
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(points[i].x - x) < Math.abs(points[nearest].x - x)) nearest = i
    }
    setHoverIndex(nearest)
  }

  return (
    <div className="chart-block">
      <div className="row">
        <div>
          <span className="muted small">{label} · latest</span>
          <div className="hero-figure">
            {last.numeric}
            <span className="hero-unit">{unit}</span>
          </div>
          <span className="muted small">
            {change === 0
              ? 'No change'
              : `${change > 0 ? '+' : ''}${change.toFixed(1)} ${unit} since ${formatDate(first.measured_on)}`}
          </span>
        </div>
        <button type="button" className="link" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {showTable ? (
        <table className="data-table">
          <thead>
            <tr><th>Date</th><th>{label}</th></tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.id}>
                <td>{formatDate(p.measured_on)}</td>
                <td>{p.numeric} {unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg
          className="chart"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${label} over time, from ${first.numeric} to ${last.numeric} ${unit}`}
          onPointerMove={handleMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left} x2={WIDTH - PAD.right}
                y1={yFor(tick)} y2={yFor(tick)}
                className="grid-line"
              />
              <text x={PAD.left - 8} y={yFor(tick) + 4} className="axis-text" textAnchor="end">
                {tick}
              </text>
            </g>
          ))}

          <text x={first.x} y={HEIGHT - 10} className="axis-text" textAnchor="start">
            {formatDate(first.measured_on)}
          </text>
          {points.length > 1 && (
            <text x={last.x} y={HEIGHT - 10} className="axis-text" textAnchor="end">
              {formatDate(last.measured_on)}
            </text>
          )}

          <path d={path} fill="none" stroke={SERIES_COLOR} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />

          {active && (
            <line
              x1={active.x} x2={active.x} y1={PAD.top} y2={PAD.top + PLOT_HEIGHT}
              className="crosshair"
            />
          )}

          {points.map((p) => (
            <circle
              key={p.id} cx={p.x} cy={p.y} r="4"
              fill={SERIES_COLOR} stroke="var(--surface)" strokeWidth="2"
            />
          ))}

          {/* Endpoint is the only directly labelled value — the axis and
              tooltip carry the rest. */}
          <text x={last.x + 8} y={last.y + 4} className="axis-text strong" textAnchor="start">
            {last.numeric}
          </text>

          {active && (
            <g transform={`translate(${Math.min(active.x + 10, WIDTH - 130)}, ${PAD.top + 6})`}>
              <rect className="tooltip-box" width="120" height="42" rx="6" />
              <line x1="10" x2="26" y1="17" y2="17" stroke={SERIES_COLOR} strokeWidth="2"
                    strokeLinecap="round" />
              <text x="32" y="21" className="tooltip-value">{active.numeric} {unit}</text>
              <text x="10" y="34" className="tooltip-label">{formatDate(active.measured_on)}</text>
            </g>
          )}
        </svg>
      )}
    </div>
  )
}
