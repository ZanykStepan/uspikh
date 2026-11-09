import { semesterNumber } from "../domain/academic.js";

export function applyForElective(c) {
  const { db, actor, body, resource, currentDate, fail, id, audit, electiveLimitsFor, electiveUsage } = c;
  if (actor.role !== "student") fail(403, "Заявку подає студент.");
  if (actor.student_status === "graduated" || db.groups.find((group) => group.group_id === actor.group_id)?.status !== "active")
    fail(403, "Запис доступний лише студентам активних груп.");
  const d = db.disciplines.find((x) => x.discipline_id === Number(body.discipline_id) && x.is_elective && x.status === "active");
  const s = db.semesters.find((x) => x.semester_id === Number(body.semester_id));
  const eligibleAssignment = db.teaching_assignments.find(
    (assignment) =>
      assignment.discipline_id === d?.discipline_id &&
      assignment.semester_id === s?.semester_id &&
      assignment.roster_group_ids.includes(actor.group_id) &&
      assignment.course_at_assignment === db.groups.find((group) => group.group_id === actor.group_id)?.course,
  );
  if (!d || !s || !eligibleAssignment || d.semester_number !== semesterNumber(eligibleAssignment.course_at_assignment, s.term_number))
    fail(422, "Дисципліна недоступна в обраному семестрі.");
  if (d.enrollment_start && currentDate() < d.enrollment_start) fail(409, "Запис на дисципліну ще не розпочався.");
  if (d.enrollment_deadline && currentDate() > d.enrollment_deadline) fail(409, "Термін запису завершився.");
  if (
    d.capacity &&
    db.elective_enrollments.filter((e) => e.discipline_id === d.discipline_id && e.semester_id === s.semester_id && e.status !== "rejected")
      .length >= d.capacity
  )
    fail(409, "Місця закінчилися.");
  const previousRequest = db.elective_enrollments.find(
    (e) => e.student_id === actor.user_id && e.discipline_id === d.discipline_id && e.semester_id === s.semester_id,
  );
  if (previousRequest && previousRequest.status !== "rejected") fail(409, "Заявку вже подано.");
  const limits = electiveLimitsFor(actor.group_id),
    usage = electiveUsage(actor.user_id);
  if (usage.total >= limits.max_disciplines) fail(409, `Досягнуто загальний ліміт вибіркових дисциплін: ${limits.max_disciplines}.`);
  if (d.catalog === 1 && usage.catalog1_credits + d.credits > limits.catalog1_credits)
    fail(
      409,
      `Перевищено ліміт кредитів 1 каталогу: використано ${usage.catalog1_credits} із ${limits.catalog1_credits}, а дисципліна має ${d.credits}.`,
    );
  if (d.catalog === 2 && usage.catalog2_credits + d.credits > limits.catalog2_credits)
    fail(
      409,
      `Перевищено ліміт кредитів 2 каталогу: використано ${usage.catalog2_credits} із ${limits.catalog2_credits}, а дисципліна має ${d.credits}.`,
    );
  if (previousRequest) db.elective_enrollments = db.elective_enrollments.filter((e) => e !== previousRequest);
  const row = {
    enrollment_id: id(resource, "enrollment_id"),
    student_id: actor.user_id,
    discipline_id: d.discipline_id,
    semester_id: s.semester_id,
    status: "pending",
    enrolled_at: new Date().toISOString(),
  };
  db[resource].push(row);
  audit(actor, "elective.apply", `enrollment:${row.enrollment_id}`, d.name);
  return { status: 201, data: row };
}

export function cancelElectiveRequest(c) {
  const { db, actor, recordId, resource, fail, audit, userFaculty } = c;
  if (actor.student_status === "graduated") fail(403, "Архівний профіль доступний лише для перегляду.");
  const row = db[resource].find((x) => x.enrollment_id === recordId);
  if (!row) fail(404, "Заявку не знайдено.");
  if (userFaculty(db.users.find((u) => u.user_id === row.student_id)) !== actor.faculty) fail(403, "Заявка належить іншому факультету.");
  if (row.student_id !== actor.user_id || row.status !== "pending") fail(403, "Можна скасувати лише власну заявку, що очікує розгляду.");
  db[resource] = db[resource].filter((x) => x.enrollment_id !== recordId);
  audit(actor, "elective.cancel", `enrollment:${recordId}`, "");
  return { status: 200, data: { message: "Заявку скасовано." } };
}

export function reviewElectiveRequest(c) {
  const { db, actor, body, recordId, resource, fail, id, audit, userFaculty, assignmentGroupIds } = c;
  if (actor.role !== "dean") fail(403, "Недостатньо прав.");
  const row = db[resource].find((x) => x.enrollment_id === recordId);
  if (!row) fail(404, "Заявку не знайдено.");
  if (userFaculty(db.users.find((u) => u.user_id === row.student_id)) !== actor.faculty) fail(403, "Заявка належить іншому факультету.");
  if (!["approved", "rejected"].includes(body.status)) fail(422, "Некоректний статус.");
  const statusChanged = row.status !== body.status;
  row.status = body.status;
  if (statusChanged)
    db.notifications.push({
      notification_id: id("notifications", "notification_id"),
      user_id: row.student_id,
      message: `Заявку на вибіркову дисципліну «${db.disciplines.find((item) => item.discipline_id === row.discipline_id)?.name || ""}» ${row.status === "approved" ? "підтверджено" : "відхилено"} деканатом.`,
      is_read: false,
      created_at: new Date().toISOString(),
    });
  if (row.status === "approved")
    for (const assignment of db.teaching_assignments.filter(
      (a) =>
        a.discipline_id === row.discipline_id &&
        a.semester_id === row.semester_id &&
        assignmentGroupIds(a).includes(db.users.find((u) => u.user_id === row.student_id)?.group_id),
    )) {
      if (!assignment.roster_student_ids.includes(row.student_id)) assignment.roster_student_ids.push(row.student_id);
      assignment.student_group_ids[row.student_id] = db.users.find((u) => u.user_id === row.student_id)?.group_id;
      for (const lesson of db.lessons.filter(
        (l) =>
          l.assignment_id === assignment.assignment_id &&
          (!l.group_id || Number(assignment.student_group_ids?.[row.student_id]) === l.group_id),
      ))
        if (!db.attendance.some((a) => a.student_id === row.student_id && a.lesson_id === lesson.lesson_id))
          db.attendance.push({
            attendance_id: id("attendance", "attendance_id"),
            student_id: row.student_id,
            lesson_id: lesson.lesson_id,
            status: "unmarked",
            reason: null,
          });
    }
  audit(actor, "elective." + body.status, `enrollment:${recordId}`, "");
  return { status: 200, data: row };
}

export function saveElectiveLimits(c) {
  const { db, actor, body, fail, id, audit } = c;
  if (!["admin", "dean"].includes(actor.role)) fail(403, "Ліміти вибіркових задає деканат або адміністратор.");
  const group = db.groups.find((item) => item.group_id === Number(body.group_id) && item.status === "active");
  if (!group) fail(422, "Оберіть активну групу.");
  if (actor.role === "dean" && group.faculty !== actor.faculty) fail(403, "Група належить іншому факультету.");
  const limits = {};
  for (const [field, max] of [
    ["catalog1_credits", 60],
    ["catalog2_credits", 60],
    ["max_disciplines", 30],
  ]) {
    const number = body[field];
    if (!Number.isInteger(number) || number < 0 || number > max) fail(422, `Поле «${field}» має бути цілим числом від 0 до ${max}.`);
    limits[field] = number;
  }
  let row = db.elective_limits.find((item) => item.group_id === group.group_id);
  const stamp = { updated_by: actor.user_id, updated_at: new Date().toISOString() };
  if (row) Object.assign(row, limits, stamp);
  else {
    row = { limit_id: id("elective_limits", "limit_id"), group_id: group.group_id, ...limits, ...stamp };
    db.elective_limits.push(row);
  }
  audit(
    actor,
    "elective_limits.save",
    `group:${group.group_id}`,
    `1 каталог ${limits.catalog1_credits} кр.; 2 каталог ${limits.catalog2_credits} кр.; усього дисциплін ${limits.max_disciplines}`,
  );
  return { status: 200, data: row };
}
