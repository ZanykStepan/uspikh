import { faculties } from "../domain/academic.js";
import { isCorporateEmail } from "./authService.js";

export const directoryKeys = {
  users: "user_id",
  disciplines: "discipline_id",
  groups: "group_id",
  streams: "stream_id",
  semesters: "semester_id",
};

export function saveDirectoryRecord(c) {
  const {
    db,
    actor,
    body,
    recordId,
    resource,
    req,
    currentDate,
    fail,
    id,
    audit,
    hasRole,
    groupFaculty,
    userFaculty,
    isDate,
    disciplineDetails,
    assignmentGroupIds,
    roles,
  } = c;
  if (!["admin", "dean"].includes(actor.role) || (actor.role === "dean" && resource === "semesters"))
    fail(403, "Недостатньо прав на довідник.");
  const key = directoryKeys[resource];
  const row = req.method === "PATCH" ? db[resource].find((x) => x[key] === recordId) : null;
  if (req.method === "PATCH" && !row) fail(404, "Запис не знайдено.");
  if (row?.status === "graduated") fail(409, "Архівний запис не редагується. Історію збережено.");
  if (actor.role === "dean" && row) {
    const inFaculty =
      resource === "users"
        ? userFaculty(row) === actor.faculty
        : resource === "groups"
          ? row.faculty === actor.faculty
          : resource === "streams"
            ? row.group_ids.every((groupId) => groupFaculty(groupId) === actor.faculty)
            : resource === "disciplines"
              ? db.teaching_assignments.some((assignment) => assignment.discipline_id === row.discipline_id) &&
                db.teaching_assignments
                  .filter((assignment) => assignment.discipline_id === row.discipline_id)
                  .every((assignment) => assignmentGroupIds(assignment).every((groupId) => groupFaculty(groupId) === actor.faculty))
              : false;
    if (!inFaculty) fail(403, "Запис належить іншому факультету.");
  }
  const allowedFields = {
    users: ["full_name", "email", "role", "roles", "group_id", "curated_group_ids", "faculty", "status"],
    disciplines: [
      "name",
      "description",
      "syllabus_url",
      "credits",
      "semester_number",
      "is_elective",
      "catalog",
      "capacity",
      "enrollment_start",
      "enrollment_deadline",
      "status",
    ],
    groups: ["name", "course", "admission_year", "faculty", "specialty", "status"],
    streams: ["name", "group_ids", "status"],
    semesters: ["academic_year", "term_number", "start_date", "end_date", "is_current"],
  };
  const value = { ...(row || {}) };
  for (const field of allowedFields[resource]) if (Object.hasOwn(body, field)) value[field] = body[field];
  if (resource === "users") {
    value.full_name = String(value.full_name || "").trim();
    value.email = String(value.email || "")
      .trim()
      .toLowerCase();
    if (value.full_name.length < 3 || !isCorporateEmail(value.email))
      fail(422, "Вкажіть ПІБ і унікальну університетську пошту (@pnu.edu.ua або @cnu.edu.ua).");
    if (db.users.some((u) => u.email === value.email && u.user_id !== row?.user_id)) fail(409, "Цю адресу вже зареєстровано.");
    value.roles = Object.hasOwn(body, "roles")
      ? Array.isArray(body.roles)
        ? [...new Set(body.roles)]
        : []
      : Object.hasOwn(body, "role")
        ? [body.role]
        : value.roles || [value.role];
    if (
      !Array.isArray(value.roles) ||
      !value.roles.length ||
      value.roles.some((role) => !roles.includes(role)) ||
      !["active", "inactive"].includes(value.status || "active")
    )
      fail(422, "Оберіть щонайменше одну коректну роль і статус.");
    if (actor.role === "dean" && value.roles.some((role) => ["dean", "admin"].includes(role)))
      fail(403, "Призначення ролей деканату й адміністратора доступне лише адміністратору.");
    value.role = value.roles.includes(value.role) ? value.role : value.roles[0];
    value.status ||= "active";
    if (hasRole(value, "student") && !db.groups.some((g) => g.group_id === Number(value.group_id))) fail(422, "Оберіть наявну групу.");
    if (hasRole(value, "student") && row && Number(value.group_id) !== row.group_id) {
      if (row.student_status === "graduated") fail(409, "Випускника не можна перевести. Історія зберігається в архіві.");
      const destination = db.groups.find((group) => group.group_id === Number(value.group_id) && group.status === "active");
      if (!destination) fail(422, "Перевести студента можна лише до активної групи.");
      if (row.student_status === "repeat_pending") {
        const previous = db.groups.find((group) => group.group_id === row.group_id);
        if (
          !previous ||
          destination.course !== previous.course ||
          destination.specialty !== previous.specialty ||
          destination.faculty !== previous.faculty ||
          destination.admission_year + destination.course - 1 <= previous.admission_year + previous.course - 1
        )
          fail(422, "Для повторного курсу оберіть активну групу того самого курсу, спеціальності й факультету в новому навчальному році.");
        value.student_status = "active";
        value.repeat_of_group_id = previous.group_id;
        value.repeat_started_at = new Date().toISOString();
      }
    }
    if (hasRole(value, "curator")) {
      if (
        !Array.isArray(value.curated_group_ids) ||
        !value.curated_group_ids.length ||
        value.curated_group_ids.some((groupId) => !Number.isInteger(groupId) || !db.groups.some((g) => g.group_id === groupId))
      )
        fail(422, "Оберіть щонайменше одну групу куратора.");
      value.curated_group_ids = [...new Set(value.curated_group_ids)];
    } else value.curated_group_ids = [];
    if (row?.user_id === actor.user_id && value.status === "inactive") fail(409, "Не можна деактивувати власний профіль.");
    value.group_id = hasRole(value, "student") ? Number(value.group_id) : null;
    value.student_status = hasRole(value, "student") ? value.student_status || "active" : null;
    value.faculty = hasRole(value, "student") ? groupFaculty(value.group_id) : String(value.faculty || "").trim();
    if (!faculties.includes(value.faculty)) fail(422, "Оберіть факультет зі списку університету.");
    if (
      actor.role === "dean" &&
      (value.faculty !== actor.faculty || value.curated_group_ids.some((groupId) => groupFaculty(groupId) !== actor.faculty))
    )
      fail(403, "Обліковий запис має належати вашому факультету.");
  } else if (resource === "disciplines") {
    Object.assign(value, disciplineDetails({ description: value.description ?? "", syllabus_url: value.syllabus_url ?? "" }));
    value.name = String(value.name || "").trim();
    value.credits = Number(value.credits);
    value.semester_number = Number(value.semester_number);
    value.is_elective = Boolean(value.is_elective);
    value.catalog = value.is_elective ? Number(value.catalog) : null;
    if (value.is_elective && ![1, 2, 3].includes(value.catalog)) fail(422, "Оберіть каталог вибіркової дисципліни: 1, 2 або 3.");
    if (
      row &&
      value.semester_number !== row.semester_number &&
      db.teaching_assignments.some((assignment) => assignment.discipline_id === row.discipline_id)
    )
      fail(409, "Номер семестру закріпленої дисципліни не змінюється. Створіть нове призначення для іншого курсу.");
    if (
      value.name.length < 3 ||
      !Number.isInteger(value.credits) ||
      value.credits < 1 ||
      value.credits > 30 ||
      !Number.isInteger(value.semester_number) ||
      value.semester_number < 1 ||
      value.semester_number > 12
    )
      fail(422, "Перевірте назву, кредити та номер семестру.");
    if (
      value.is_elective &&
      (!Number.isInteger(Number(value.capacity)) ||
        Number(value.capacity) < 1 ||
        !isDate(value.enrollment_start) ||
        !isDate(value.enrollment_deadline) ||
        value.enrollment_start > value.enrollment_deadline)
    )
      fail(422, "Для вибіркової дисципліни потрібні ліміт місць і коректний період запису.");
    value.capacity = value.is_elective ? Number(value.capacity) : null;
    value.enrollment_start = value.is_elective ? value.enrollment_start : null;
    value.enrollment_deadline = value.is_elective ? value.enrollment_deadline : null;
    value.status ||= "active";
  } else if (resource === "groups") {
    value.name = String(value.name || "").trim();
    value.course = Number(value.course);
    value.admission_year = Number(value.admission_year);
    if (
      value.name.length < 2 ||
      !Number.isInteger(value.course) ||
      value.course < 1 ||
      value.course > 6 ||
      !Number.isInteger(value.admission_year)
    )
      fail(422, "Перевірте назву, курс і рік вступу.");
    value.faculty = String(value.faculty || "").trim();
    value.specialty = String(value.specialty || "").trim();
    if (value.specialty.length < 3) fail(422, "Вкажіть спеціальність групи.");
    if (!faculties.includes(value.faculty)) fail(422, "Оберіть факультет зі списку університету.");
    if (actor.role === "dean" && value.faculty !== actor.faculty) fail(403, "Група належить іншому факультету.");
    if (
      db.groups.some(
        (group) =>
          group.group_id !== row?.group_id && group.status === "active" && group.faculty === value.faculty && group.name === value.name,
      )
    )
      fail(409, "Назва групи вже використовується активною групою факультету.");
    if (row && value.course !== row.course) fail(409, "Курс наявної групи змінюється через сторінку переведення.");
    value.status ||= "active";
    if (
      row &&
      db.streams.some(
        (s) =>
          s.group_ids.includes(row.group_id) &&
          s.group_ids.some((otherId) => {
            const other = db.groups.find((g) => g.group_id === otherId);
            return (
              otherId !== row.group_id &&
              (other.course !== value.course ||
                other.admission_year !== value.admission_year ||
                other.specialty !== value.specialty ||
                other.faculty !== value.faculty)
            );
          }),
      )
    )
      fail(409, "Група у потоці повинна зберігати той самий курс, рік вступу й спеціальність.");
  } else if (resource === "streams") {
    value.name = String(value.name || "").trim();
    value.group_ids = Array.isArray(value.group_ids) ? [...new Set(value.group_ids.map(Number))] : [];
    if (
      value.name.length < 3 ||
      value.group_ids.length < 2 ||
      value.group_ids.some(
        (groupId) => !Number.isInteger(groupId) || !db.groups.some((g) => g.group_id === groupId && g.status === "active"),
      )
    )
      fail(422, "Потік має містити щонайменше дві активні групи.");
    const groups = value.group_ids.map((groupId) => db.groups.find((g) => g.group_id === groupId));
    if (
      groups.some(
        (g) =>
          g.course !== groups[0].course ||
          g.admission_year !== groups[0].admission_year ||
          g.specialty !== groups[0].specialty ||
          g.faculty !== groups[0].faculty,
      )
    )
      fail(422, "У потоці можуть бути лише групи одного курсу, року вступу, спеціальності та факультету.");
    if (actor.role === "dean" && groups.some((g) => g.faculty !== actor.faculty))
      fail(403, "Потік має складатися з груп вашого факультету.");
    value.status ||= "active";
    if (row) {
      const removed = row.group_ids.filter((groupId) => !value.group_ids.includes(groupId));
      if (removed.length && db.teaching_assignments.some((a) => a.stream_id === row.stream_id))
        fail(409, "Групу не можна вилучити з потоку, який уже має призначені дисципліни. Створіть новий потік для наступного півріччя.");
    }
  } else {
    value.academic_year = String(value.academic_year || "").trim();
    value.term_number = Number(value.term_number);
    if (
      !/^\d{4}\/\d{4}$/.test(value.academic_year) ||
      ![1, 2].includes(value.term_number) ||
      !isDate(value.start_date) ||
      !isDate(value.end_date) ||
      value.start_date >= value.end_date
    )
      fail(422, "Перевірте навчальний рік, тип і дати семестру.");
    if (
      db.semesters.some(
        (s) => s.semester_id !== row?.semester_id && s.academic_year === value.academic_year && s.term_number === value.term_number,
      )
    )
      fail(409, "Це півріччя навчального року вже існує.");
    value.is_current = Boolean(value.is_current);
  }
  let newAssignment = null;
  if (resource === "disciplines" && !row) {
    const input = body.assignment || {};
    const teacher = db.users.find((u) => u.user_id === Number(input.teacher_id) && hasRole(u, "teacher") && u.status === "active");
    const sem = db.semesters.find((s) => s.semester_id === Number(input.semester_id));
    const targetType = input.target_type;
    const group = targetType === "group" ? db.groups.find((g) => g.group_id === Number(input.group_id) && g.status === "active") : null;
    const stream =
      targetType === "stream" ? db.streams.find((s) => s.stream_id === Number(input.stream_id) && s.status === "active") : null;
    if (!teacher || !sem || (targetType !== "group" && targetType !== "stream") || (!group && !stream))
      fail(422, "Оберіть викладача, семестр та активну групу або потік.");
    const targetGroup = group || db.groups.find((g) => g.group_id === stream.group_ids[0]);
    if (actor.role === "dean" && (targetGroup.faculty !== actor.faculty || userFaculty(teacher) !== actor.faculty))
      fail(403, "Призначення має належати вашому факультету.");
    if (value.semester_number !== targetGroup.course * 2 - (sem.term_number === 1 ? 1 : 0))
      fail(422, "Номер семестру дисципліни не відповідає курсу групи або потоку.");
    if (Number(sem.academic_year.slice(0, 4)) !== targetGroup.admission_year + targetGroup.course - 1)
      fail(422, "Навчальний рік не відповідає курсу та року вступу групи.");
    const rosterGroups = group ? [group.group_id] : [...stream.group_ids];
    const rosterStudents = value.is_elective
      ? []
      : db.users.filter((u) => hasRole(u, "student") && u.status === "active" && rosterGroups.includes(u.group_id)).map((u) => u.user_id);
    newAssignment = {
      assignment_id: id("teaching_assignments", "assignment_id"),
      teacher_id: teacher.user_id,
      discipline_id: null,
      group_id: group?.group_id || null,
      stream_id: stream?.stream_id || null,
      semester_id: sem.semester_id,
      course_at_assignment: targetGroup.course,
      roster_group_ids: rosterGroups,
      roster_student_ids: rosterStudents,
      student_group_ids: Object.fromEntries(
        rosterStudents.map((studentId) => [studentId, db.users.find((u) => u.user_id === studentId)?.group_id]),
      ),
      roster_group_names: Object.fromEntries(rosterGroups.map((groupId) => [groupId, db.groups.find((g) => g.group_id === groupId)?.name])),
      target_name_at_assignment: group?.name || stream?.name,
    };
  }
  const streamAdded = resource === "streams" && row ? value.group_ids.filter((groupId) => !row.group_ids.includes(groupId)) : [];
  if (resource === "semesters" && value.is_current)
    db.semesters.forEach((s) => {
      s.is_current = false;
    });
  const oldGroupId = resource === "users" ? row?.group_id : null;
  if (row) Object.assign(row, value);
  else {
    value[key] = id(resource, key);
    db[resource].push(value);
  }
  if (resource === "groups" && !row) {
    const year = value.admission_year + value.course - 1;
    for (const term of [1, 2])
      if (!db.semesters.some((semester) => semester.academic_year === `${year}/${year + 1}` && semester.term_number === term))
        db.semesters.push({
          semester_id: id("semesters", "semester_id"),
          academic_year: `${year}/${year + 1}`,
          term_number: term,
          start_date: term === 1 ? `${year}-09-01` : `${year + 1}-02-01`,
          end_date: term === 1 ? `${year}-12-31` : `${year + 1}-06-30`,
          is_current: false,
        });
  }
  if (resource === "users" && !row) {
    if (hasRole(value, "student"))
      for (const assignment of db.teaching_assignments.filter(
        (a) =>
          a.roster_group_ids.includes(value.group_id) &&
          !db.disciplines.find((d) => d.discipline_id === a.discipline_id)?.is_elective &&
          db.semesters.find((s) => s.semester_id === a.semester_id)?.end_date >= currentDate(),
      )) {
        assignment.roster_student_ids.push(value.user_id);
        assignment.student_group_ids[value.user_id] = value.group_id;
        for (const lesson of db.lessons.filter(
          (l) => l.assignment_id === assignment.assignment_id && (!l.group_id || l.group_id === value.group_id),
        ))
          db.attendance.push({
            attendance_id: id("attendance", "attendance_id"),
            student_id: value.user_id,
            lesson_id: lesson.lesson_id,
            status: "unmarked",
            reason: null,
          });
      }
  }
  if (resource === "users" && row && hasRole(value, "student") && oldGroupId !== value.group_id) {
    for (const assignment of db.teaching_assignments.filter(
      (item) =>
        item.roster_group_ids.includes(value.group_id) &&
        !db.disciplines.find((discipline) => discipline.discipline_id === item.discipline_id)?.is_elective &&
        db.semesters.find((semester) => semester.semester_id === item.semester_id)?.end_date >= currentDate(),
    )) {
      if (!assignment.roster_student_ids.includes(value.user_id)) assignment.roster_student_ids.push(value.user_id);
      assignment.student_group_ids[value.user_id] = value.group_id;
      for (const lesson of db.lessons.filter(
        (item) => item.assignment_id === assignment.assignment_id && (!item.group_id || item.group_id === value.group_id),
      ))
        if (!db.attendance.some((entry) => entry.lesson_id === lesson.lesson_id && entry.student_id === value.user_id))
          db.attendance.push({
            attendance_id: id("attendance", "attendance_id"),
            student_id: value.user_id,
            lesson_id: lesson.lesson_id,
            status: "unmarked",
            reason: null,
          });
    }
  }
  if (newAssignment) {
    newAssignment.discipline_id = value.discipline_id;
    db.teaching_assignments.push(newAssignment);
    audit(
      actor,
      "assignment.create",
      `assignment:${newAssignment.assignment_id}`,
      `${value.name}; викладач ${newAssignment.teacher_id}; ${newAssignment.group_id ? "група " + newAssignment.group_id : "потік " + newAssignment.stream_id}`,
    );
  }
  if (resource === "streams" && row) {
    for (const assignment of db.teaching_assignments.filter(
      (a) => a.stream_id === value.stream_id && db.semesters.find((s) => s.semester_id === a.semester_id)?.end_date >= currentDate(),
    )) {
      for (const groupId of streamAdded) {
        if (!assignment.roster_group_ids.includes(groupId)) assignment.roster_group_ids.push(groupId);
        assignment.roster_group_names[groupId] = db.groups.find((g) => g.group_id === groupId)?.name;
      }
      for (const student of db.users.filter((u) => hasRole(u, "student") && streamAdded.includes(u.group_id) && u.status === "active")) {
        if (
          db.disciplines.find((d) => d.discipline_id === assignment.discipline_id)?.is_elective &&
          !db.elective_enrollments.some(
            (e) =>
              e.student_id === student.user_id &&
              e.discipline_id === assignment.discipline_id &&
              e.semester_id === assignment.semester_id &&
              e.status === "approved",
          )
        )
          continue;
        if (!assignment.roster_student_ids.includes(student.user_id)) assignment.roster_student_ids.push(student.user_id);
        assignment.student_group_ids[student.user_id] = student.group_id;
        for (const lesson of db.lessons.filter(
          (l) => l.assignment_id === assignment.assignment_id && (!l.group_id || l.group_id === student.group_id),
        ))
          if (!db.attendance.some((a) => a.lesson_id === lesson.lesson_id && a.student_id === student.user_id))
            db.attendance.push({
              attendance_id: id("attendance", "attendance_id"),
              student_id: student.user_id,
              lesson_id: lesson.lesson_id,
              status: "unmarked",
              reason: null,
            });
      }
    }
  }
  audit(
    actor,
    `${resource}.${row ? "update" : "create"}`,
    `${resource}:${value[key]}`,
    value.name || value.full_name || value.academic_year,
  );
  if (resource === "users") {
    const { password_hash, ...publicUser } = value;
    return { status: row ? 200 : 201, data: publicUser };
  }
  return { status: row ? 200 : 201, data: value };
}
