// docs/03 §7: (present + late) / (present + late + absent); unmarked and excused
// don't count. Null when nothing counted. The one rule, for every screen.
export function attendancePercent(c: { present: number; late: number; absent: number }): number | null {
  const counted = c.present + c.late + c.absent;
  return counted ? Math.round(((c.present + c.late) / counted) * 100) : null;
}
