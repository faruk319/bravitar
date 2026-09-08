/** A rule worth knowing, out of the way until asked for. */
export default function InfoDot({ children }) {
  return (
    <span className="info-dot" tabIndex={0}>
      i<span className="info-bubble">{children}</span>
    </span>
  )
}
