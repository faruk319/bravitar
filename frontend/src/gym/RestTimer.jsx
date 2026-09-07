import { useEffect, useRef, useState } from 'react'

/** Counts down the rest between sets. Restarts whenever `startedAt` changes. */
export default function RestTimer({ seconds, startedAt, onDone }) {
  const [now, setNow] = useState(() => Date.now())
  const onDoneRef = useRef(onDone)

  useEffect(() => {
    onDoneRef.current = onDone
  })

  useEffect(() => {
    if (!startedAt) return
    const interval = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [startedAt])

  const remaining = startedAt ? seconds - Math.floor((now - startedAt) / 1000) : 0
  const isDone = startedAt && remaining <= 0

  useEffect(() => {
    if (isDone) onDoneRef.current?.()
  }, [isDone])

  if (!startedAt || isDone) return null

  const minutes = Math.floor(remaining / 60)
  const secs = String(remaining % 60).padStart(2, '0')

  return (
    <div className="rest-timer">
      <strong>{minutes}:{secs}</strong>
      <span className="muted small">rest</span>
    </div>
  )
}
