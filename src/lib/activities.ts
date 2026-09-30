// The modules Bravitar sells (agreed 2026-09-30); in code they are activities,
// since "modules" are the feature switches. A new one needs an entry here and a
// migration row; the platform edits names, icons, status and plans, never the list.
export const ACTIVITY_KEYS = ["tuition", "deeniyat", "karate", "dance", "sports", "general", "gym", "swimming"] as const;
export type ActivityKey = (typeof ACTIVITY_KEYS)[number];

export type ActivityFeature = { name: string; ready: boolean };
const planned = (...names: string[]): ActivityFeature[] => names.map((name) => ({ name, ready: false }));

// Each module's own features, on top of the shared ones every module gets.
const ACTIVITY_FEATURES: Record<ActivityKey, ActivityFeature[]> = {
  tuition: [],
  deeniyat: [],
  karate: planned("Belt and grade progression", "Techniques"),
  dance: planned("Levels", "Choreography and progression"),
  sports: [],
  general: [],
  gym: planned("Workout and training plans", "Fitness progression"),
  swimming: planned("Lanes and pool capacity", "Slot booking", "Swimming skills and progression"),
};

export const isActivityKey = (s: string): s is ActivityKey => (ACTIVITY_KEYS as readonly string[]).includes(s);
export const featuresOf = (key: string): ActivityFeature[] => (isActivityKey(key) ? ACTIVITY_FEATURES[key] : []);

// The icons a module can show; <ActivityIcon> draws them.
export const ACTIVITY_ICONS = [
  "graduation-cap",
  "book-open",
  "shield",
  "music",
  "trophy",
  "shapes",
  "dumbbell",
  "waves",
  "drama",
  "palette",
  "medal",
  "target",
  "bike",
  "volleyball",
  "person-standing",
  "brain",
] as const;
export type ActivityIconName = (typeof ACTIVITY_ICONS)[number];

export const isActivityIcon = (s: string): s is ActivityIconName => (ACTIVITY_ICONS as readonly string[]).includes(s);
