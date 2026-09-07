import BodyLog from '../gym/BodyLog'
import ExerciseLibrary from '../gym/ExerciseLibrary'
import Nutrition from '../gym/Nutrition'
import RoutineBuilder from '../gym/RoutineBuilder'

/**
 * Maps a module key from verticals.js to the component that renders it.
 * A module with no entry here is still listed in the dashboard but shows a
 * "not built yet" placeholder — that's how later phases get slotted in.
 */
export const MODULE_COMPONENTS = {
  exercises: ExerciseLibrary,
  workouts: RoutineBuilder,
  bodylog: BodyLog,
  nutrition: Nutrition,
}
