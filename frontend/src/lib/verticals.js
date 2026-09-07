/**
 * The UI half of the plugin system: which dashboard modules each vertical
 * turns on. Mirrors organizations/constants.py on the backend — a new vertical
 * is added here and there, not by touching the dashboard itself.
 */

// Every vertical gets these — the cross-vertical core (Phase 4).
const CORE_MODULES = [
  { key: 'members', label: 'Members' },
  { key: 'batches', label: 'Batches & Schedule' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'billing', label: 'Fees & Billing' },
  { key: 'enquiries', label: 'Enquiries' },
]

export const VERTICALS = [
  {
    value: 'gym',
    label: 'Gym / Fitness',
    modules: [
      { key: 'exercises', label: 'Exercise Library' },
      { key: 'workouts', label: 'Workout Routines' },
      { key: 'nutrition', label: 'Nutrition' },
      { key: 'bodylog', label: 'Body & Progress' },
    ],
  },
  {
    value: 'swimming',
    label: 'Swimming Academy',
    modules: [
      { key: 'lanes', label: 'Lanes & Pool Slots' },
      { key: 'levels', label: 'Skill Levels' },
    ],
  },
  {
    value: 'dance',
    label: 'Dance Academy',
    modules: [
      { key: 'styles', label: 'Dance Styles' },
      { key: 'choreography', label: 'Choreography' },
    ],
  },
  {
    value: 'karate',
    label: 'Karate / Martial Arts',
    modules: [
      { key: 'belts', label: 'Belts & Gradings' },
      { key: 'sparring', label: 'Sparring Records' },
    ],
  },
  {
    value: 'football',
    label: 'Football Academy',
    modules: [
      { key: 'teams', label: 'Teams & Squads' },
      { key: 'matches', label: 'Matches & Fixtures' },
    ],
  },
]

export function verticalLabel(value) {
  return VERTICALS.find((v) => v.value === value)?.label ?? value
}

/** Modules to show for an organization, based on the verticals it selected. */
export function modulesForVerticals(verticals = []) {
  const pluginModules = verticals.flatMap(
    (value) => VERTICALS.find((v) => v.value === value)?.modules ?? [],
  )
  return [...CORE_MODULES, ...pluginModules]
}
