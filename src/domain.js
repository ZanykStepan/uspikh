import { lessonTypes } from "../shared/academic.mjs";
export { lessonTypes, gradeScales, defaultScale, faculties, normalizedGrade, semesterNumber, convertSemesterScore } from "../shared/academic.mjs";
export { assignmentGroupIds, weightScheme, scoreBreakdown, GradeCalculator, gradingStrategies } from "../shared/grading.mjs";

let todayOverride = null;
// Сервер повідомляє «поточну» дату (у демонстраційному режимі вона може бути вигаданою).
export const setToday = (value) => { todayOverride = value || null; };
export const todayKyiv = () => todayOverride || new Date().toLocaleDateString("sv-SE",{timeZone:"Europe/Kyiv"});

export const average = (values) =>
  values.length
    ? Math.round((values.reduce((s, x) => s + x, 0) / values.length) * 10) / 10
    : null;
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
