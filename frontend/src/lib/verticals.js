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
    implemented: true,
    label: 'Gym Management',
    description: 'Memberships, check-ins, classes and trainers.',
    modules: [
      { key: 'checkin', label: 'Check In' },
      { key: 'tiers', label: 'Membership Plans' },
      { key: 'memberships', label: 'Memberships' },
      { key: 'renewals', label: 'Renewals' },
    ],
  },
  {
    value: 'fitness',
    implemented: true,
    label: 'Fitness Tracking',
    description: 'Workouts, nutrition and body progress for members.',
    modules: [
      { key: 'exercises', label: 'Exercise Library' },
      { key: 'workouts', label: 'Workout Routines' },
      { key: 'nutrition', label: 'Nutrition' },
      { key: 'bodylog', label: 'Body & Progress' },
      { key: 'musclemap', label: 'Muscle Map' },
      { key: 'activity', label: 'Training Activity' },
    ],
  },
  {
    value: 'swimming',
    implemented: true,
    label: 'Swimming Academy',
    modules: [
      { key: 'lanes', label: 'Lanes & Pool Slots' },
      { key: 'levels', label: 'Skill Levels' },
    ],
  },
  {
    value: 'dance',
    implemented: false,
    label: 'Dance Academy',
    modules: [
      { key: 'styles', label: 'Dance Styles' },
      { key: 'choreography', label: 'Choreography' },
    ],
  },
  {
    value: 'karate',
    implemented: true,
    label: 'Karate / Martial Arts',
    modules: [
      { key: 'belts', label: 'Belts & Gradings' },
      { key: 'sparring', label: 'Sparring Records' },
    ],
  },
  {
    value: 'football',
    implemented: false,
    label: 'Football Academy',
    modules: [
      { key: 'teams', label: 'Teams & Squads' },
      { key: 'matches', label: 'Matches & Fixtures' },
    ],
  },
]

/**
 * Verticals an academy can actually choose. Dance and football are described
 * here so the platform knows about them, but offering a module with nothing
 * behind it is worse than not listing it — the backend refuses them too.
 */
export const SELECTABLE_VERTICALS = VERTICALS.filter((v) => v.implemented)

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
