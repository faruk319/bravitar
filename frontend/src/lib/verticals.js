/**
 * The UI half of the plugin system: which dashboard modules each vertical
 * turns on. Mirrors organizations/constants.py on the backend — a new vertical
 * is added here and there, not by touching the dashboard itself.
 */

// Every vertical gets these — the cross-vertical core (Phase 4).
const CORE_MODULES = [
  { key: 'members', label: 'Members' },
  { key: 'batches', label: 'Batches & Classes' },
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
      { key: 'tiers', label: 'Membership Plans' },
      { key: 'memberships', label: 'Memberships' },
      { key: 'renewals', label: 'Renewals' },
      { key: 'trainers', label: 'Trainers' },
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

/**
 * Modules grouped the way they are actually thought about: the cross-vertical
 * core first, then one group per sport. An academy running four verticals has
 * twenty modules, which is a list nobody reads — the sidebar opens one group
 * at a time off the back of this.
 */
export function moduleGroups(verticals = []) {
  const plugins = verticals
    .map((value) => VERTICALS.find((v) => v.value === value))
    .filter((v) => v?.modules?.length)
    .map((v) => ({ key: v.value, label: v.label, modules: v.modules }))
  return [{ key: 'core', label: 'Everyday', modules: CORE_MODULES }, ...plugins]
}

/** The same modules flat, for lookups and the dashboard tiles. */
export function modulesForVerticals(verticals = []) {
  return moduleGroups(verticals).flatMap((group) => group.modules)
}
