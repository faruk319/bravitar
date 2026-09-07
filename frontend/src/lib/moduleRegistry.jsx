import Attendance from '../academy/Attendance'
import Batches from '../academy/Batches'
import Billing from '../academy/Billing'
import Enquiries from '../academy/Enquiries'
import Members from '../academy/Members'
import ActivityHeatmap from '../gym/ActivityHeatmap'
import BodyLog from '../gym/BodyLog'
import ExerciseLibrary from '../gym/ExerciseLibrary'
import MuscleMap from '../gym/MuscleMap'
import Nutrition from '../gym/Nutrition'
import RoutineBuilder from '../gym/RoutineBuilder'

/**
 * Maps a module key from verticals.js to the component that renders it.
 * A module with no entry here is still listed in the dashboard but shows a
 * "not built yet" placeholder — that's how later phases get slotted in.
 */
export const MODULE_COMPONENTS = {
  // Cross-vertical core — every vertical gets these
  members: Members,
  batches: Batches,
  attendance: Attendance,
  billing: Billing,
  enquiries: Enquiries,

  // Gym plugin
  exercises: ExerciseLibrary,
  workouts: RoutineBuilder,
  bodylog: BodyLog,
  nutrition: Nutrition,
  musclemap: MuscleMap,
  activity: ActivityHeatmap,
}
