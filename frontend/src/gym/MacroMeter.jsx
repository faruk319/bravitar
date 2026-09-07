/**
 * Progress toward one macro target. The bar carries severity, but the numbers
 * and the "over" label carry it too — colour never says it alone.
 */
export default function MacroMeter({ label, value, target, unit }) {
  const consumed = Number(value ?? 0)
  const goal = Number(target ?? 0)
  const ratio = goal > 0 ? consumed / goal : 0
  const percent = Math.round(ratio * 100)

  const severity = ratio > 1.1 ? 'critical' : ratio > 1 ? 'warning' : 'on-track'
  const remaining = Math.round(goal - consumed)

  return (
    <div className="meter">
      <div className="meter-head">
        <span className="muted small">{label}</span>
        <span className="meter-value">
          {Math.round(consumed)}
          <span className="muted"> / {Math.round(goal)} {unit}</span>
        </span>
      </div>

      <div
        className="meter-track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${Math.round(consumed)} of ${Math.round(goal)} ${unit}`}
      >
        <div className={`meter-fill ${severity}`} style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
      </div>

      <span className="muted small">
        {goal === 0
          ? 'No target set'
          : remaining >= 0
            ? `${remaining} ${unit} left · ${percent}%`
            : `${Math.abs(remaining)} ${unit} over · ${percent}%`}
      </span>
    </div>
  )
}
