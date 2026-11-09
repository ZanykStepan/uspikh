import { isArchivedStudent } from "../domain/validators.js";
import { directoryKeys } from "./directoryService.js";

const names = {
  users: (row) => row.full_name,
  groups: (row) => row.name,
  streams: (row) => row.name,
  semesters: (row) => `${row.term_number} семестр ${row.academic_year}`,
  disciplines: (row) => row.name,
};

export function deleteDirectoryRecord(c) {
  const { db, actor, recordId, resource, fail, audit } = c;
  if (actor.role !== "admin") fail(403, "Видаляти записи довідників може лише адміністратор.");
  const key = directoryKeys[resource];
  const row = db[resource].find((item) => item[key] === recordId);
  if (!row) fail(404, "Запис не знайдено.");
  if (row.status === "graduated" || isArchivedStudent(row.student_status)) fail(409, "Архівний запис не видаляється. Історію збережено.");

  const used = [];
  const some = (list, test) => list.some(test);
  if (resource === "users") {
    if (row.user_id === actor.user_id) fail(409, "Не можна видалити власний обліковий запис.");
    if (some(db.grades, (g) => g.student_id === recordId || g.recorded_by === recordId || g.approved_by === recordId)) used.push("оцінки");
    if (some(db.attendance, (a) => a.student_id === recordId && a.status !== "unmarked")) used.push("відвідуваність");
    if (some(db.debts, (d) => d.student_id === recordId)) used.push("заборгованості");
    if (some(db.elective_enrollments, (e) => e.student_id === recordId)) used.push("заявки на вибіркові");
    if (some(db.grade_correction_requests, (r) => [r.student_id, r.requested_by, r.reviewed_by].includes(recordId)))
      used.push("запити на виправлення");
    if (some(db.grade_history, (h) => h.changed_by === recordId || h.requested_by === recordId)) used.push("історію оцінок");
    if (some(db.teaching_assignments, (a) => a.teacher_id === recordId)) used.push("призначення викладача");
    if (some(db.lessons, (l) => l.approved_by === recordId)) used.push("відновлені екзамени");
    if (some(db.weight_schemes, (w) => w.updated_by === recordId) || some(db.elective_limits, (l) => l.updated_by === recordId))
      used.push("налаштування");
    if (
      some(db.audit_logs, (entry) => entry.actor_id === recordId) ||
      some(db.group_promotions, (p) => p.actor_id === recordId) ||
      some(db.graduations, (g) => g.actor_id === recordId)
    )
      used.push("записи журналу дій");
  } else if (resource === "groups") {
    if (some(db.users, (u) => u.group_id === recordId || u.repeat_of_group_id === recordId)) used.push("студентів");
    if (some(db.teaching_assignments, (a) => a.group_id === recordId || a.roster_group_ids.includes(recordId)))
      used.push("призначення дисциплін");
    if (some(db.streams, (s) => s.group_ids.includes(recordId))) used.push("потік");
  } else if (resource === "streams") {
    if (some(db.teaching_assignments, (a) => a.stream_id === recordId)) used.push("призначення дисциплін");
  } else if (resource === "semesters") {
    if (row.is_current) used.push("позначку поточного семестру");
    if (some(db.teaching_assignments, (a) => a.semester_id === recordId)) used.push("призначення дисциплін");
    if (some(db.weight_schemes, (w) => w.semester_id === recordId)) used.push("ваги");
    if (some(db.debts, (d) => d.semester_id === recordId) || some(db.elective_enrollments, (e) => e.semester_id === recordId))
      used.push("борги або заявки");
  } else if (resource === "disciplines") {
    if (some(db.teaching_assignments, (a) => a.discipline_id === recordId)) used.push("призначення викладачів");
    if (some(db.weight_schemes, (w) => w.discipline_id === recordId)) used.push("ваги");
    if (some(db.debts, (d) => d.discipline_id === recordId) || some(db.elective_enrollments, (e) => e.discipline_id === recordId))
      used.push("борги або заявки");
  }
  if (used.length) fail(409, `Запис не можна видалити: з ним пов’язані ${used.join(", ")}. Деактивуйте його замість видалення.`);

  const label = names[resource](row);
  audit(actor, `${resource}.delete`, `${resource}:${recordId}`, label);

  if (resource === "users") {
    for (const assignment of db.teaching_assignments) {
      if (!assignment.roster_student_ids.includes(recordId)) continue;
      assignment.roster_student_ids = assignment.roster_student_ids.filter((studentId) => studentId !== recordId);
      delete assignment.student_group_ids[recordId];
    }
    db.attendance = db.attendance.filter((a) => a.student_id !== recordId);
    db.notifications = db.notifications.filter((n) => n.user_id !== recordId);
  }
  if (resource === "groups") {
    db.elective_limits = db.elective_limits.filter((limit) => limit.group_id !== recordId);
    for (const user of db.users) user.curated_group_ids = (user.curated_group_ids || []).filter((groupId) => groupId !== recordId);
  }
  db[resource] = db[resource].filter((item) => item[key] !== recordId);
  return { status: 200, data: { message: `Запис «${label}» видалено.` } };
}
