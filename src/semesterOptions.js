export function visibleSemesters(db) {
  if (!db) return [];
  if (db.me?.role !== "student") return db.semesters;

  const relevantIds = new Set([
    ...db.teaching_assignments.map((assignment) => assignment.semester_id),
    ...(db.elective_offerings || []).map((offering) => offering.semester_id),
  ]);
  const relevant = db.semesters.filter((semester) => relevantIds.has(semester.semester_id));
  if (relevant.length) return relevant;

  // A newly enrolled student may have no assignments yet.
  const current = db.semesters.find((semester) => semester.is_current);
  return current ? [current] : [];
}
