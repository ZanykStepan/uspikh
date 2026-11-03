import { lessonTypes } from "../shared/academic.mjs";
export { lessonTypes, gradeScales, defaultScale, faculties, normalizedGrade, semesterNumber, convertSemesterScore } from "../shared/academic.mjs";

let todayOverride = null;
// Сервер повідомляє «поточну» дату (у демонстраційному режимі вона може бути вигаданою).
export const setToday = (value) => { todayOverride = value || null; };
export const todayKyiv = () => todayOverride || new Date().toLocaleDateString("sv-SE",{timeZone:"Europe/Kyiv"});

export const average = (values) =>
  values.length
    ? Math.round((values.reduce((s, x) => s + x, 0) / values.length) * 10) / 10
    : null;
export function assignmentGroupIds(db, assignment) {
  if (!assignment) return [];
  return assignment.roster_group_ids || (assignment.stream_id
    ? db.streams.find((stream) => stream.stream_id === assignment.stream_id)?.group_ids || []
    : assignment.group_id ? [assignment.group_id] : []);
}
export function weightScheme(db, assignment) {
  if (!assignment) return null;
  const groupId = assignmentGroupIds(db, assignment)[0];
  const course = assignment.course_at_assignment || db.groups.find((group) => group.group_id === groupId)?.course;
  return db.weight_schemes?.find((scheme) => scheme.discipline_id === assignment.discipline_id && scheme.course === course && scheme.semester_id === assignment.semester_id) || null;
}
export function scoreBreakdown(db, assignment, studentId) {
  const scheme = weightScheme(db, assignment);
  const studentGroupId = Number(assignment?.student_group_ids?.[studentId]);
  const lessons = db.lessons.filter((lesson) => lesson.assignment_id === assignment?.assignment_id && (!lesson.group_id || lesson.group_id === studentGroupId));
  const types = lessonTypes.map((type) => {
    const values = lessons.filter((lesson) => lesson.lesson_type === type)
      .map((lesson) => {
        const grade = db.grades.find((item) => item.student_id === studentId && item.lesson_id === lesson.lesson_id);
        const maximum = lesson.max_score || 100;
        return grade && Number.isInteger(grade.value) && grade.value >= 0 && grade.value <= maximum && maximum > 0 ? grade.value / maximum * 100 : null;
      })
      .filter((value) => value != null);
    const rawMean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const mean = values.length ? Math.round(rawMean * 10) / 10 : null;
    const weight = scheme?.weights[type] ?? null;
    return { type, mean, count: values.length, weight, contribution: weight === null ? null : Math.round(rawMean * weight / 10) / 10, rawContribution: weight === null ? null : rawMean * weight / 100 };
  });
  return { scheme, types, gradedCount: types.reduce((sum, row) => sum + row.count, 0), semesterScore: scheme ? Math.min(100, Math.round(types.reduce((sum, row) => sum + row.rawContribution, 0) * 10) / 10) : null };
}
export function semesterLessons(db, semester) {
  const ids = db.teaching_assignments
    .filter((a) => a.semester_id === Number(semester))
    .map((a) => a.assignment_id);
  return db.lessons.filter((l) => ids.includes(l.assignment_id));
}
export function gradeContext(db, g) {
  const l = db.lessons.find((l) => l.lesson_id === g.lesson_id);
  const a = db.teaching_assignments.find(
    (a) => a.assignment_id === l?.assignment_id,
  );
  return {
    lesson: l,
    discipline: db.disciplines.find(
      (d) => d.discipline_id === a?.discipline_id,
    ),
    student: db.users.find((u) => u.user_id === g.student_id),
  };
}
export function validateGrade(value, reason, editing, maximum = 100) {
  if (
    !(typeof value === "number" ? Number.isInteger(value) : typeof value === "string" && /^\d+$/.test(value)) ||
    !Number.isInteger(maximum) || maximum < 1 || maximum > 100 ||
    !Number.isInteger(Number(value)) ||
    Number(value) < 0 ||
    Number(value) > maximum
  )
    return `Введіть ціле число від 0 до ${maximum}.`;
  if (editing && (reason.trim().length < 5 || reason.trim().length > 255))
    return "Причина виправлення має містити від 5 до 255 символів.";
  return "";
}
