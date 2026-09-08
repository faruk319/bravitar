import { setCurrentAcademy } from '../lib/academy'

/**
 * Which academy you're looking at, for an organization that runs more than one.
 *
 * "All academies" is the owner's view across the whole business; a manager
 * always works in one, because two sets of books on one screen is an owner's
 * call. Changing it reloads — every screen already asks the API afresh, and
 * re-fetching them piecemeal would leave some showing the old academy.
 */
export default function AcademyPicker({ academies, current, maySeeAll }) {
  if (academies.length < 2) return null

  return (
    <label className="academy-picker">
      <span className="muted small">Academy</span>
      <select
        value={current ?? ''}
        onChange={(e) => {
          setCurrentAcademy(e.target.value || null)
          window.location.reload()
        }}
      >
        {maySeeAll && <option value="all">All academies</option>}
        {!current && !maySeeAll && <option value="">Choose an academy…</option>}
        {academies.map((academy) => (
          <option key={academy.id} value={academy.slug}>{academy.name}</option>
        ))}
      </select>
    </label>
  )
}
