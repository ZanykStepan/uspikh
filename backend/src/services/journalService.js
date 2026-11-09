import { lessonTypes, defaultScale } from "../domain/academic.js";

export function updateDisciplineDetails(c) {
  const { db, actor, body, recordId, fail, audit, disciplineDetails } = c;
  if (actor.role !== "teacher") fail(403, "Опис дисципліни редагує призначений викладач.");
  const discipline = db.disciplines.find((item) => item.discipline_id === recordId);
  if (!discipline) fail(404, "Дисципліну не знайдено.");
  if (!db.teaching_assignments.some((assignment) => assignment.discipline_id === recordId && assignment.teacher_id === actor.user_id))
    fail(403, "Дисципліна не закріплена за вами.");
  Object.assign(discipline, disciplineDetails(body));
  audit(actor, "discipline.details.update", `discipline:${recordId}`, "Оновлено опис або посилання на силабус");
  return { status: 200, data: discipline };
}

export function saveWeightScheme(c) {
  const { db, actor, body, fail, id, audit, completed } = c;
  if (actor.role !== "teacher") fail(403, "Ваги встановлює викладач.");
  const disciplineId = Number(body.discipline_id),
    semesterId = Number(body.semester_id),
    course = Number(body.course);
  if (
    !Number.isInteger(course) ||
    !db.teaching_assignments.some(
      (a) =>
        a.teacher_id === actor.user_id &&
        a.discipline_id === disciplineId &&
        a.semester_id === semesterId &&
        a.course_at_assignment === course,
    )
  )
    fail(403, "Дисципліна й курс не закріплені за викладачем.");
  if (completed(semesterId)) fail(409, "Семестр завершено. Ваги заблоковані для звичайного редагування.");
  const types = lessonTypes;
  const weights = {};
  for (const type of types) {
    const value = body.weights?.[type];
    if (!Number.isInteger(value) || value < 0 || value > 100) fail(422, "Введіть цілі ваги від 0 до 100 для кожного типу занять.");
    weights[type] = value;
  }
  if (Object.values(weights).reduce((sum, value) => sum + value, 0) !== 100) fail(422, "Сума ваг має дорівнювати 100%.");
  let row = db.weight_schemes.find((w) => w.discipline_id === disciplineId && w.course === course && w.semester_id === semesterId);
  if (row) Object.assign(row, { weights, updated_by: actor.user_id, updated_at: new Date().toISOString() });
  else {
    row = {
      scheme_id: id("weight_schemes", "scheme_id"),
      discipline_id: disciplineId,
      course,
      semester_id: semesterId,
      weights,
      updated_by: actor.user_id,
      updated_at: new Date().toISOString(),
    };
    db.weight_schemes.push(row);
  }
  audit(actor, "weights.save", `discipline:${disciplineId};course:${course};semester:${semesterId}`, JSON.stringify(weights));
  return { status: 200, data: row };
}

export function createLesson(c) {
  const { db, actor, body, fail, id, audit, hasRole, isDate, completed, eligibleForAssignment } = c;
  if (!["teacher", "dean"].includes(actor.role)) fail(403, "Заняття створює викладач; історичний екзамен відновлює деканат.");
  const assignment = db.teaching_assignments.find(
    (a) =>
      a.assignment_id === Number(body.assignment_id) &&
      (actor.role === "teacher"
        ? a.teacher_id === actor.user_id
        : a.roster_group_ids.some((groupId) => db.groups.find((group) => group.group_id === groupId)?.faculty === actor.faculty)),
  );
  if (!assignment) fail(403, "Дисципліна не належить до вашої сфери доступу.");
  const historicExam = completed(assignment.semester_id) && actor.role === "dean" && body.lesson_type === "Екзамен";
  if (completed(assignment.semester_id) && !historicExam) fail(409, "Семестр завершено. Історичний екзамен може відновити лише деканат.");
  if (!completed(assignment.semester_id) && actor.role !== "teacher") fail(403, "Поточні заняття створює викладач.");
  const semester = db.semesters.find((s) => s.semester_id === assignment.semester_id);
  const topic = String(body.topic || "").trim();
  if (topic.length < 3 || topic.length > 160) fail(422, "Вкажіть тему заняття (3–160 символів).");
  if (!lessonTypes.includes(body.lesson_type)) fail(422, "Оберіть тип заняття.");
  const maxScore = Number(body.max_score ?? defaultScale(body.lesson_type));
  if (!Number.isInteger(maxScore) || maxScore < 1 || maxScore > 100) fail(422, "Максимум заняття має бути цілим числом від 1 до 100.");
  const lessonGroupId = body.group_id == null ? null : Number(body.group_id);
  if (lessonGroupId && !assignment.roster_group_ids.includes(lessonGroupId)) fail(422, "Група не належить до цього призначення.");
  if (historicExam) {
    const reason = String(body.reason || "").trim();
    if (reason.length < 5 || reason.length > 255) fail(422, "Поясніть причину відновлення історичного екзамену (5–255 символів).");
    if (
      db.lessons.some(
        (item) =>
          item.assignment_id === assignment.assignment_id &&
          item.lesson_type === "Екзамен" &&
          (!item.group_id || !lessonGroupId || item.group_id === lessonGroupId),
      )
    )
      fail(409, "Для вибраної групи вже існує екзаменаційне заняття.");
  }
  if (!isDate(body.lesson_date) || body.lesson_date < semester.start_date || body.lesson_date > semester.end_date)
    fail(422, "Дата має належати семестру.");
  const row = {
    lesson_id: id("lessons", "lesson_id"),
    assignment_id: assignment.assignment_id,
    group_id: lessonGroupId,
    lesson_date: body.lesson_date,
    lesson_type: body.lesson_type,
    max_score: maxScore,
    topic,
    ...(historicExam ? { approved_by: actor.user_id, retroactive_reason: String(body.reason).trim() } : {}),
  };
  db.lessons.push(row);
  db.users
    .filter(
      (u) =>
        hasRole(u, "student") &&
        eligibleForAssignment(assignment, u.user_id) &&
        (!lessonGroupId || Number(assignment.student_group_ids?.[u.user_id]) === lessonGroupId) &&
        u.status === "active",
    )
    .forEach((u) =>
      db.attendance.push({
        attendance_id: id("attendance", "attendance_id"),
        student_id: u.user_id,
        lesson_id: row.lesson_id,
        status: "unmarked",
        reason: null,
      }),
    );
  audit(
    actor,
    historicExam ? "lesson.retroactive_exam" : "lesson.create",
    `lesson:${row.lesson_id}`,
    historicExam ? `${topic}; ${row.retroactive_reason}` : topic,
  );
  return { status: 201, data: row };
}

export function saveGrade(c) {
  const { db, actor, body, recordId, req, fail, id, audit, hasRole, completed, eligibleForAssignment, canLesson } = c;
  const previous = req.method === "PATCH" ? db.grades.find((x) => x.grade_id === recordId) : null;
  if (req.method === "PATCH" && !previous) fail(404, "Оцінку не знайдено.");
  const lessonId = previous?.lesson_id ?? Number(body.lesson_id),
    studentId = previous?.student_id ?? Number(body.student_id);
  if (!canLesson(lessonId)) fail(403, "Немає права редагувати це заняття.");
  const lesson = db.lessons.find((l) => l.lesson_id === lessonId),
    assignment = db.teaching_assignments.find((a) => a.assignment_id === lesson.assignment_id);
  if (completed(assignment.semester_id)) fail(409, "Семестр завершено. Подайте запит на виправлення оцінки до деканату.");
  if (
    !db.users.some(
      (u) =>
        u.user_id === studentId &&
        hasRole(u, "student") &&
        eligibleForAssignment(assignment, u.user_id) &&
        (!lesson.group_id || Number(assignment.student_group_ids?.[u.user_id]) === lesson.group_id),
    )
  )
    fail(422, "Студент не належить до групи заняття.");
  if (typeof body.value !== "number" || !Number.isInteger(body.value) || body.value < 0 || body.value > (lesson.max_score || 100))
    fail(422, `Введіть ціле число від 0 до ${lesson.max_score || 100}.`);
  if (previous && (!(typeof body.reason === "string") || body.reason.trim().length < 5 || body.reason.trim().length > 255))
    fail(422, "Причина виправлення має містити від 5 до 255 символів.");
  if (!previous && db.grades.some((g) => g.student_id === studentId && g.lesson_id === lessonId))
    fail(409, "Оцінка вже існує. Відредагуйте наявний запис.");
  const now = new Date().toISOString();
  if (previous) {
    const oldValue = previous.value;
    db.grade_history.push({
      history_id: id("grade_history", "history_id"),
      grade_id: previous.grade_id,
      old_value: previous.value,
      new_value: body.value,
      changed_by: actor.user_id,
      changed_at: now,
      reason: body.reason.trim(),
    });
    previous.value = body.value;
    previous.updated_at = now;
    audit(actor, "grade.update", `grade:${previous.grade_id}`, `${oldValue} → ${body.value}; причина: ${body.reason.trim()}`);
  } else
    db.grades.push({
      grade_id: id("grades", "grade_id"),
      student_id: studentId,
      lesson_id: lessonId,
      value: body.value,
      recorded_by: actor.user_id,
      given_at: now,
      updated_at: now,
    });
  if (!previous) audit(actor, "grade.create", `lesson:${lessonId};student:${studentId}`, `${body.value} балів`);
  db.notifications.push({
    notification_id: id("notifications", "notification_id"),
    user_id: studentId,
    message: `Нову оцінку ${body.value} внесено до журналу.`,
    is_read: false,
    created_at: now,
  });
  return { status: previous ? 200 : 201, data: { message: "Оцінку збережено." } };
}

export function requestGradeCorrection(c) {
  const { db, actor, body, fail, id, audit, completed, eligibleForAssignment } = c;
  if (actor.role !== "teacher") fail(403, "Запит на виправлення подає викладач.");
  const lesson = db.lessons.find((item) => item.lesson_id === Number(body.lesson_id));
  const assignment = db.teaching_assignments.find(
    (item) => item.assignment_id === lesson?.assignment_id && item.teacher_id === actor.user_id,
  );
  const studentId = Number(body.student_id);
  if (
    !assignment ||
    !eligibleForAssignment(assignment, studentId) ||
    (lesson.group_id && Number(assignment.student_group_ids?.[studentId]) !== lesson.group_id)
  )
    fail(403, "Це заняття не закріплене за викладачем і студентом.");
  if (!completed(assignment.semester_id)) fail(409, "Поки семестр триває, оцінку можна змінити без запиту до деканату.");
  if (!Number.isInteger(body.proposed_value) || body.proposed_value < 0 || body.proposed_value > (lesson.max_score || 100))
    fail(422, `Введіть ціле число від 0 до ${lesson.max_score || 100}.`);
  const reason = String(body.reason || "").trim();
  if (reason.length < 5 || reason.length > 255) fail(422, "Поясніть причину виправлення (5–255 символів).");
  const existing = db.grades.find((grade) => grade.lesson_id === lesson.lesson_id && grade.student_id === studentId);
  if (existing?.value === body.proposed_value) fail(409, "Запропонований бал збігається з наявним.");
  if (
    db.grade_correction_requests.some(
      (request) => request.lesson_id === lesson.lesson_id && request.student_id === studentId && request.status === "pending",
    )
  )
    fail(409, "Для цього заняття й студента вже є запит на розгляді.");
  const row = {
    request_id: id("grade_correction_requests", "request_id"),
    lesson_id: lesson.lesson_id,
    student_id: studentId,
    proposed_value: body.proposed_value,
    previous_value: existing?.value ?? null,
    reason,
    requested_by: actor.user_id,
    requested_at: new Date().toISOString(),
    status: "pending",
  };
  db.grade_correction_requests.push(row);
  audit(actor, "grade_correction.request", `request:${row.request_id}`, `${row.previous_value ?? "—"} → ${row.proposed_value}; ${reason}`);
  return { status: 201, data: row };
}

export function reviewGradeCorrection(c) {
  const { db, actor, body, recordId, fail, id, audit, userFaculty, reconcileDebts } = c;
  if (actor.role !== "dean") fail(403, "Запит розглядає деканат.");
  const row = db.grade_correction_requests.find((request) => request.request_id === recordId);
  if (!row) fail(404, "Запит не знайдено.");
  if (userFaculty(db.users.find((user) => user.user_id === row.student_id)) !== actor.faculty)
    fail(403, "Студент належить іншому факультету.");
  if (row.status !== "pending" || !["approved", "rejected"].includes(body.status))
    fail(422, "Можна затвердити або відхилити лише запит на розгляді.");
  if (body.status === "approved") {
    const existing = db.grades.find((grade) => grade.lesson_id === row.lesson_id && grade.student_id === row.student_id);
    if ((existing?.value ?? null) !== row.previous_value) fail(409, "Оцінка змінилася після подання запиту. Потрібен новий запит.");
    const now = new Date().toISOString();
    if (existing) {
      db.grade_history.push({
        history_id: id("grade_history", "history_id"),
        grade_id: existing.grade_id,
        old_value: existing.value,
        new_value: row.proposed_value,
        changed_by: actor.user_id,
        requested_by: row.requested_by,
        changed_at: now,
        reason: row.reason,
      });
      existing.value = row.proposed_value;
      existing.updated_at = now;
    } else
      db.grades.push({
        grade_id: id("grades", "grade_id"),
        student_id: row.student_id,
        lesson_id: row.lesson_id,
        value: row.proposed_value,
        recorded_by: row.requested_by,
        approved_by: actor.user_id,
        given_at: now,
        updated_at: now,
      });
    db.notifications.push({
      notification_id: id("notifications", "notification_id"),
      user_id: row.student_id,
      message: `Деканат погодив виправлення оцінки: ${row.proposed_value}.`,
      is_read: false,
      created_at: now,
    });
  }
  row.status = body.status;
  row.reviewed_by = actor.user_id;
  row.reviewed_at = new Date().toISOString();
  audit(
    actor,
    `grade_correction.${body.status}`,
    `request:${row.request_id}`,
    `${row.previous_value ?? "—"} → ${row.proposed_value}; ${row.reason}`,
  );
  reconcileDebts();
  return { status: 200, data: row };
}

export function updateAttendance(c) {
  const { db, actor, body, recordId, fail, id, audit, completed, canLesson } = c;
  const row = db.attendance.find((x) => x.attendance_id === recordId);
  if (!row) fail(404, "Запис не знайдено.");
  if (!canLesson(row.lesson_id)) fail(403, "Немає права редагувати відвідуваність.");
  if (
    completed(
      db.teaching_assignments.find(
        (assignment) => assignment.assignment_id === db.lessons.find((lesson) => lesson.lesson_id === row.lesson_id)?.assignment_id,
      )?.semester_id,
    )
  )
    fail(409, "Семестр завершено. Відвідуваність заблокована.");
  if (!["present", "absent"].includes(body.status)) fail(422, "Оберіть присутність або пропуск.");
  if (body.status === "absent" && !["поважна", "неповажна"].includes(body.reason)) fail(422, "Оберіть причину пропуску.");
  const changed = row.status !== body.status || row.reason !== (body.status === "present" ? null : body.reason);
  Object.assign(row, {
    status: body.status,
    reason: body.status === "present" ? null : body.reason,
  });
  audit(actor, "attendance.update", `attendance:${recordId}`, `${row.status}${row.reason ? ": " + row.reason : ""}`);
  if (changed && row.status === "absent")
    db.notifications.push({
      notification_id: id("notifications", "notification_id"),
      user_id: row.student_id,
      message: "У журналі відмічено пропуск заняття (" + row.reason + ").",
      is_read: false,
      created_at: new Date().toISOString(),
    });
  return { status: 200, data: row };
}

export function markAllNotificationsRead(c) {
  const { db, actor } = c;
  let updated = 0;
  for (const item of db.notifications) {
    if (item.user_id === actor.user_id && !item.is_read) {
      item.is_read = true;
      updated += 1;
    }
  }
  return { status: 200, data: { updated } };
}

export function markNotificationRead(c) {
  const { db, actor, recordId, fail } = c;
  const row = db.notifications.find((x) => x.notification_id === recordId && x.user_id === actor.user_id);
  if (!row) fail(404, "Сповіщення не знайдено.");
  row.is_read = true;
  return { status: 200, data: row };
}
