import { lessonTypes, legacyLessonTypes, defaultScale, faculties, semesterNumber } from "../domain/academic.js";
import { scoreBreakdown } from "../domain/scoring.js";
import { fail } from "../utils/httpError.js";

export const roles = ["student", "teacher", "curator", "dean", "admin"];

export function createContext(db, { currentDate, actor }) {
  const hasRole = (user, role) => user?.roles?.includes(role) || user?.role === role;
  const groupFaculty = (groupId) => db.groups.find((g) => g.group_id === groupId)?.faculty;
  const userFaculty = (user) => groupFaculty(user?.group_id) || user?.faculty;
  const id = (table, key) => Math.max(0, ...db[table].map((x) => x[key])) + 1;
  const isDate = (value) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  const defaultElectiveLimits = { catalog1_credits: 9, catalog2_credits: 12, max_disciplines: 10 };
  const electiveLimitsFor = (groupId) => {
    const row = db.elective_limits.find((item) => item.group_id === groupId);
    return {
      ...defaultElectiveLimits,
      ...(row
        ? { catalog1_credits: row.catalog1_credits, catalog2_credits: row.catalog2_credits, max_disciplines: row.max_disciplines }
        : {}),
    };
  };
  const electiveUsage = (studentId) => {
    const usage = { total: 0, catalog1_credits: 0, catalog2_credits: 0 };
    for (const entry of db.elective_enrollments.filter((item) => item.student_id === studentId && item.status !== "rejected")) {
      const discipline = db.disciplines.find((item) => item.discipline_id === entry.discipline_id);
      usage.total += 1;
      if (discipline?.catalog === 1) usage.catalog1_credits += discipline.credits;
      if (discipline?.catalog === 2) usage.catalog2_credits += discipline.credits;
    }
    return usage;
  };
  const disciplineDetails = (value) => {
    if (
      typeof value.description !== "string" ||
      value.description.length > 2000 ||
      typeof value.syllabus_url !== "string" ||
      value.syllabus_url.length > 2048
    )
      fail(422, "Опис має містити до 2000 символів, а посилання — до 2048.");
    const description = value.description.trim();
    const syllabus_url = value.syllabus_url.trim();
    if (syllabus_url) {
      let parsed;
      try {
        parsed = new URL(syllabus_url);
      } catch {
        fail(422, "Вкажіть повне посилання на силабус із https:// або http://.");
      }
      if (!["https:", "http:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password)
        fail(422, "Вкажіть безпечне посилання на силабус із https:// або http://.");
    }
    return { description, syllabus_url };
  };
  const audit = (actor, action, target, detail) => {
    db.audit_logs.push({
      audit_id: id("audit_logs", "audit_id"),
      actor_id: actor.user_id,
      action,
      target,
      detail,
      at: new Date().toISOString(),
    });
  };
  const assignmentGroupIds = (assignment) =>
    assignment.roster_group_ids ||
    (assignment.stream_id
      ? db.streams.find((s) => s.stream_id === assignment.stream_id)?.group_ids || []
      : assignment.group_id
        ? [assignment.group_id]
        : []);
  const eligibleForAssignment = (assignment, studentId) => {
    const student = db.users.find((u) => u.user_id === studentId && hasRole(u, "student"));
    if (!student || !assignment.roster_student_ids?.includes(studentId)) return false;
    const discipline = db.disciplines.find((d) => d.discipline_id === assignment.discipline_id);
    return (
      !discipline?.is_elective ||
      db.elective_enrollments.some(
        (enrollment) =>
          enrollment.student_id === studentId &&
          enrollment.discipline_id === assignment.discipline_id &&
          enrollment.semester_id === assignment.semester_id &&
          enrollment.status === "approved",
      )
    );
  };
  const completed = (semesterId) => db.semesters.find((semester) => semester.semester_id === semesterId)?.end_date < currentDate();
  const debtCriteria = (assignment, studentId) => {
    const result = scoreBreakdown(db, assignment, studentId);
    if (!result.scheme) return { needsDebt: false, reason: "Ваги не встановлено", score: null };
    const examMissing =
      (result.scheme.weights["Екзамен"] || 0) > 0 &&
      !db.lessons.some(
        (lesson) =>
          lesson.assignment_id === assignment.assignment_id &&
          lesson.lesson_type === "Екзамен" &&
          (!lesson.group_id || Number(assignment.student_group_ids?.[studentId]) === lesson.group_id) &&
          db.grades.some((grade) => grade.lesson_id === lesson.lesson_id && grade.student_id === studentId),
      );
    const lowScore = result.semesterScore < 50;
    return {
      needsDebt: lowScore || examMissing,
      reason: [
        lowScore ? `Підсумковий бал ${result.semesterScore} нижче 50` : null,
        examMissing ? "Немає оцінки обов’язкового екзамену" : null,
      ]
        .filter(Boolean)
        .join("; "),
      score: result.semesterScore,
    };
  };
  const reconcileDebts = () => {
    let changed = false;
    for (const assignment of db.teaching_assignments.filter((item) => completed(item.semester_id)))
      for (const studentId of assignment.roster_student_ids || []) {
        if (!eligibleForAssignment(assignment, studentId)) continue;
        const criteria = debtCriteria(assignment, studentId);
        if (!criteria.needsDebt) continue;
        const row = db.debts.find(
          (debt) =>
            debt.student_id === studentId && debt.discipline_id === assignment.discipline_id && debt.semester_id === assignment.semester_id,
        );
        if (!row) {
          const debt = {
            debt_id: id("debts", "debt_id"),
            student_id: studentId,
            discipline_id: assignment.discipline_id,
            semester_id: assignment.semester_id,
            reason: criteria.reason,
            deadline: null,
            status: "open",
            source: "automatic",
            created_at: new Date().toISOString(),
          };
          db.debts.push(debt);
          db.notifications.push({
            notification_id: id("notifications", "notification_id"),
            user_id: studentId,
            message: `Виникла академічна заборгованість: ${criteria.reason}. Термін ліквідації встановить деканат.`,
            is_read: false,
            created_at: new Date().toISOString(),
          });
          changed = true;
        } else if (row.status === "closed" || row.reason !== criteria.reason) {
          if (row.status === "closed") {
            row.status = "open";
            row.deadline = null;
          }
          row.reason = criteria.reason;
          changed = true;
        }
      }
  };
  const progressionPreview = (rawIds) => {
    const groupIds = Array.isArray(rawIds) ? [...new Set(rawIds.map(Number))] : [];
    if (!groupIds.length || groupIds.some((groupId) => !Number.isInteger(groupId))) fail(422, "Оберіть групи для переведення.");
    const groups = groupIds.map((groupId) => db.groups.find((group) => group.group_id === groupId && group.status === "active"));
    if (groups.some((group) => !group)) fail(422, "Оберіть активні групи.");
    if (groups.some((group) => group.course >= 6)) fail(422, "Шостий курс є останнім: переведення далі недоступне.");
    for (const stream of db.streams.filter((item) => item.status === "active"))
      if (stream.group_ids.some((id) => groupIds.includes(id)) && !stream.group_ids.every((id) => groupIds.includes(id)))
        fail(422, `Групи потоку «${stream.name}» потрібно перевести разом.`);
    const years = [...new Set(groups.map((group) => group.admission_year + group.course - 1))];
    if (years.length !== 1) fail(422, "Разом можна перевести групи лише одного навчального року.");
    const startYear = years[0] + 1;
    const nextYear = `${startYear}/${startYear + 1}`;
    if (
      db.teaching_assignments.some(
        (assignment) =>
          db.semesters.find((semester) => semester.semester_id === assignment.semester_id)?.academic_year === nextYear &&
          assignmentGroupIds(assignment).some((id) => groupIds.includes(id)),
      )
    )
      fail(409, "На наступний навчальний рік уже є призначені дисципліни цих груп. Спочатку перевірте їх.");
    const rows = groups.map((group) => ({
      group_id: group.group_id,
      name: group.name,
      faculty: group.faculty,
      admission_year: group.admission_year,
      course_before: group.course,
      course_after: group.course + 1,
      student_count: db.users.filter((user) => hasRole(user, "student") && user.group_id === group.group_id && user.status === "active")
        .length,
    }));
    for (const row of rows) {
      const nextName = row.name.replace(/-(\d)(\d+)$/, (match, course, suffix) =>
        Number(course) === row.course_before ? `-${row.course_after}${suffix}` : match,
      );
      if (
        db.groups.some(
          (group) =>
            group.status === "active" && group.faculty === row.faculty && group.name === nextName && !groupIds.includes(group.group_id),
        )
      )
        fail(409, `Назва «${nextName}» вже зайнята активною групою. Спочатку випустіть відповідний курс.`);
    }
    const key = JSON.stringify({
      groupIds: [...groupIds].sort((a, b) => a - b),
      nextYear,
      courses: rows.map((row) => [row.group_id, row.course_before]),
    });
    return {
      group_ids: groupIds,
      rows,
      next_academic_year: nextYear,
      new_semesters: [1, 2].filter(
        (term) => !db.semesters.some((semester) => semester.academic_year === nextYear && semester.term_number === term),
      ),
      frozen_assignments: db.teaching_assignments.filter((assignment) => assignmentGroupIds(assignment).some((id) => groupIds.includes(id)))
        .length,
      key,
    };
  };
  const graduationPreview = (rawIds) => {
    const groupIds = Array.isArray(rawIds) ? [...new Set(rawIds.map(Number))].sort((a, b) => a - b) : [];
    if (!groupIds.length || groupIds.some((groupId) => !Number.isInteger(groupId))) fail(422, "Оберіть групи для випуску.");
    const groups = groupIds.map((groupId) => db.groups.find((group) => group.group_id === groupId && group.status === "active"));
    if (groups.some((group) => !group)) fail(422, "Випустити можна лише активні групи.");
    if (groups.some((group) => ![4, 6].includes(group.course))) fail(422, "Випуск доступний після 4-го або 6-го курсу.");
    if (new Set(groups.map((group) => `${group.admission_year}|${group.course}`)).size !== 1)
      fail(422, "Разом випускають групи одного року вступу та курсу.");
    for (const stream of db.streams.filter((item) => item.status === "active"))
      if (
        stream.group_ids.some((groupId) => groupIds.includes(groupId)) &&
        !stream.group_ids.every((groupId) => groupIds.includes(groupId))
      )
        fail(422, `Групи потоку «${stream.name}» потрібно випустити разом.`);
    const startYear = groups[0].admission_year + groups[0].course - 1;
    const academicYear = `${startYear}/${startYear + 1}`;
    const finalTerm = db.semesters.find((semester) => semester.academic_year === academicYear && semester.term_number === 2);
    const studentIds = db.users
      .filter((user) => hasRole(user, "student") && groupIds.includes(user.group_id) && user.student_status !== "graduated")
      .map((user) => user.user_id);
    const heldIds = [
      ...new Set(db.debts.filter((debt) => studentIds.includes(debt.student_id) && debt.status === "open").map((debt) => debt.student_id)),
    ];
    const blockers = [];
    if (!finalTerm) blockers.push(`Для ${academicYear} ще не створено 2 півріччя.`);
    else if (finalTerm.end_date >= currentDate())
      blockers.push(`2 півріччя завершується ${finalTerm.end_date}; випуск доступний після цієї дати.`);
    const rows = groups.map((group) => {
      const students = db.users.filter(
        (user) => hasRole(user, "student") && user.group_id === group.group_id && user.student_status !== "graduated",
      );
      const graduates = students.filter((student) => !heldIds.includes(student.user_id));
      const held = students.filter((student) => heldIds.includes(student.user_id));
      return {
        group_id: group.group_id,
        name: group.name,
        archived_name: `${group.name} (вип. ${startYear + 1})`,
        faculty: group.faculty,
        course: group.course,
        admission_year: group.admission_year,
        student_count: students.length,
        graduate_ids: graduates.map((student) => student.user_id),
        graduate_names: graduates.map((student) => student.full_name),
        held_ids: held.map((student) => student.user_id),
        held_names: held.map((student) => student.full_name),
      };
    });
    if (!rows.some((row) => row.graduate_ids.length)) blockers.push("У вибраних групах немає студентів, які можуть випуститися.");
    const streams = db.streams
      .filter((stream) => stream.status === "active" && stream.group_ids.every((groupId) => groupIds.includes(groupId)))
      .map((stream) => ({ stream_id: stream.stream_id, name: stream.name, archived_name: `${stream.name} (вип. ${startYear + 1})` }));
    const key = JSON.stringify({
      groupIds,
      academicYear,
      rows: rows.map((row) => [row.group_id, row.name, row.course, row.graduate_ids, row.held_ids]),
      streams: streams.map((stream) => stream.stream_id),
      blockers,
    });
    return {
      group_ids: groupIds,
      academic_year: academicYear,
      graduation_year: startYear + 1,
      course: groups[0].course,
      rows,
      streams,
      blockers,
      key,
    };
  };
  const canLesson = (lessonId) => {
    const l = db.lessons.find((x) => x.lesson_id === lessonId);
    const a = db.teaching_assignments.find((x) => x.assignment_id === l?.assignment_id);
    return a && actor?.role === "teacher" && a.teacher_id === actor.user_id;
  };
  return {
    db,
    actor,
    currentDate,
    fail,
    id,
    audit,
    hasRole,
    groupFaculty,
    userFaculty,
    isDate,
    disciplineDetails,
    completed,
    debtCriteria,
    reconcileDebts,
    eligibleForAssignment,
    assignmentGroupIds,
    electiveLimitsFor,
    electiveUsage,
    defaultElectiveLimits,
    progressionPreview,
    graduationPreview,
    canLesson,
    roles,
    semesterNumber,
  };
}
