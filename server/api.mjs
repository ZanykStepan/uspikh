import { seed } from "./seed.mjs";
import { checkPassword, passwordHash } from "./auth.mjs";
import { randomBytes } from "node:crypto";
import { lessonTypes, legacyLessonTypes, gradeScales, defaultScale, faculties, semesterNumber } from "../shared/academic.mjs";
import { scoreBreakdown } from "../src/domain.js";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { dirname } from "node:path";
export function createApi(file, { allowDemoHeader = !file, today } = {}) {
  let db =
    file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : seed();
  const sessions = new Map();
  // Підхоплення даних із попередньої версії навчального прототипу.
  db.audit_logs ||= [];
  db.weight_schemes ||= [];
  db.grade_correction_requests ||= [];
  db.graduations ||= [];
  db.elective_limits ||= [];
  const currentDate = () => typeof today === "function" ? today() : today || new Date().toLocaleDateString("sv-SE",{timeZone:"Europe/Kyiv"});
  db.groups.forEach((g) => { g.specialty ||= "Інженерія програмного забезпечення"; });
  if (!db.groups.some((g) => g.name === "ІПЗ-42" || g.name.startsWith("ІПЗ-42 (вип. "))) db.groups.push({ group_id: Math.max(...db.groups.map((g) => g.group_id)) + 1, name: "ІПЗ-42", admission_year: 2023, course: 4, faculty: "Факультет математики та інформатики", specialty: "Інженерія програмного забезпечення", status: "active" });
  const demoSecondGroup = db.groups.find((g) => g.name === "ІПЗ-42" || g.name.startsWith("ІПЗ-42 (вип. "));
  if (!db.users.some((u) => u.role === "student" && u.group_id === demoSecondGroup.group_id)) {
    for (const suffix of ["04", "05"]) db.users.push({ user_id: Math.max(...db.users.map((u) => u.user_id)) + 1, full_name: `Демо студент ${suffix}`, role: "student", group_id: demoSecondGroup.group_id, status: "active" });
  }
  db.streams ||= [];
  if (!db.streams.length) db.streams.push({ stream_id: 1, name: "Потік ІПЗ-4", group_ids: [db.groups.find((g) => g.name === "ІПЗ-41")?.group_id || 1, demoSecondGroup.group_id], status: "active" });
  for (const disciplineId of [5, 6]) if (db.disciplines.some((d) => d.discipline_id === disciplineId) && !db.teaching_assignments.some((a) => a.discipline_id === disciplineId)) db.teaching_assignments.push({ assignment_id: Math.max(0, ...db.teaching_assignments.map((a) => a.assignment_id)) + 1, teacher_id: 7, discipline_id: disciplineId, group_id: null, stream_id: db.streams[0].stream_id, semester_id: 2 });
  db.users.filter((u) => u.role === "curator").forEach((u) => { u.curated_group_ids ||= [u.group_id || 1, demoSecondGroup.group_id]; });
  if (!db.users.some((u) => u.role === "dean"))
    db.users.push({ user_id: 11, full_name: "Представник деканату", email: "demo11@pnu.edu.ua", role: "dean", status: "active" });
  db.users.forEach((u) => { u.email ||= `demo${u.user_id}@pnu.edu.ua`; u.password_hash ||= passwordHash(u.user_id); });
  const roles = ["student", "teacher", "curator", "dean", "admin"];
  db.users.forEach((u) => {
    u.roles ||= [u.role];
    if (u.roles.includes("student")) u.student_status ||= u.status === "graduated" ? "graduated" : "active";
    if (u.user_id === 7 && !u.roles.includes("curator")) u.roles.push("curator");
    if (u.user_id === 7) u.curated_group_ids ||= [1, demoSecondGroup.group_id];
    u.faculty ||= db.groups.find((g) => g.group_id === u.group_id)?.faculty || "Факультет математики та інформатики";
  });
  const hasRole = (user, role) => user?.roles?.includes(role) || user?.role === role;
  const groupFaculty = (groupId) => db.groups.find((g) => g.group_id === groupId)?.faculty;
  const userFaculty = (user) => groupFaculty(user?.group_id) || user?.faculty;
  db.lessons.forEach((lesson) => { lesson.lesson_type = legacyLessonTypes[lesson.lesson_type] || lesson.lesson_type; lesson.max_score ||= defaultScale(lesson.lesson_type); });
  db.weight_schemes.forEach((scheme) => {
    const previous = scheme.weights || {};
    scheme.weights = Object.fromEntries(lessonTypes.map((type) => [type, 0]));
    for (const [oldType, weight] of Object.entries(previous)) scheme.weights[legacyLessonTypes[oldType] || oldType] = weight;
  });
  // Історичний склад та курс закріплені за призначенням, а не за поточним станом групи.
  for (const assignment of db.teaching_assignments) {
    const groupIds = assignment.stream_id ? db.streams.find((s) => s.stream_id === assignment.stream_id)?.group_ids || [] : [assignment.group_id].filter(Boolean);
    assignment.roster_group_ids ||= [...groupIds];
    assignment.course_at_assignment ||= db.groups.find((g) => g.group_id === groupIds[0])?.course || 1;
    assignment.roster_student_ids ||= db.users.filter((u) => hasRole(u,"student") && groupIds.includes(u.group_id) && (!db.disciplines.find((d) => d.discipline_id === assignment.discipline_id)?.is_elective || db.elective_enrollments.some((e) => e.student_id === u.user_id && e.discipline_id === assignment.discipline_id && e.semester_id === assignment.semester_id && e.status === "approved"))).map((u) => u.user_id);
    assignment.student_group_ids ||= Object.fromEntries(assignment.roster_student_ids.map((studentId) => [studentId, db.users.find((u) => u.user_id === studentId)?.group_id]));
    assignment.roster_group_names ||= Object.fromEntries(assignment.roster_group_ids.map((groupId) => [groupId, db.groups.find((g) => g.group_id === groupId)?.name]));
    assignment.target_name_at_assignment ||= assignment.stream_id ? db.streams.find((s) => s.stream_id === assignment.stream_id)?.name : db.groups.find((g) => g.group_id === assignment.group_id)?.name;
  }
  // Демонстрація звичайної дисципліни для двох груп одного потоку.
  const demoAssignment = db.teaching_assignments.find((a) => a.assignment_id === 1);
  if (!db.demo_stream_migrated && demoAssignment && demoAssignment.discipline_id === 1 && demoAssignment.semester_id === 1 && db.streams.some((s) => s.stream_id === 1)) {
    demoAssignment.group_id = null; demoAssignment.stream_id = 1; demoAssignment.roster_group_ids = [...db.streams.find((s) => s.stream_id === 1).group_ids];
    demoAssignment.target_name_at_assignment = db.streams.find((s) => s.stream_id === 1).name;
    demoAssignment.roster_group_names = Object.fromEntries(demoAssignment.roster_group_ids.map((groupId) => [groupId, db.groups.find((g) => g.group_id === groupId)?.name]));
    demoAssignment.roster_student_ids = [...new Set([...demoAssignment.roster_student_ids, ...db.users.filter((u) => hasRole(u,"student") && demoAssignment.roster_group_ids.includes(u.group_id)).map((u) => u.user_id)])];
    for (const studentId of demoAssignment.roster_student_ids) demoAssignment.student_group_ids[studentId] ||= db.users.find((u) => u.user_id === studentId)?.group_id;
    for (const lesson of db.lessons.filter((l) => l.assignment_id === demoAssignment.assignment_id)) for (const studentId of demoAssignment.roster_student_ids) if (!db.attendance.some((a) => a.lesson_id === lesson.lesson_id && a.student_id === studentId)) db.attendance.push({ attendance_id: Math.max(0, ...db.attendance.map((a) => a.attendance_id)) + 1, student_id: studentId, lesson_id: lesson.lesson_id, status: "unmarked", reason: null });
  }
  db.demo_stream_migrated = true;
  db.debts = (db.debts || []).filter((debt) => !(debt.debt_id === 1 && debt.student_id === 1 && debt.discipline_id === 3 && debt.semester_id === 1 && debt.deadline === "2026-11-05"));
  db.disciplines.forEach((d) => {
    if (d.is_elective) { d.catalog ||= { 5: 1, 6: 2 }[d.discipline_id] || 3; d.capacity ??= 25; d.enrollment_deadline ||= "2026-12-15"; d.enrollment_start ||= new Date(new Date(d.enrollment_deadline+"T12:00:00Z").getTime()-90*86400000).toISOString().slice(0,10); }
  });
  db.notifications.forEach((notification) => { notification.message = notification.message.replaceAll("весняний семестр", "2 півріччя").replaceAll("осінній семестр", "1 півріччя"); });
  const persist = () => {
    if (file) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file + ".tmp", JSON.stringify(db, null, 2));
      renameSync(file + ".tmp", file);
    }
  };
  const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  // Типові ліміти вибіркових; для кожної групи їх може змінити деканат або адміністратор.
  const defaultElectiveLimits = { catalog1_credits: 9, catalog2_credits: 12, max_disciplines: 10 };
  const electiveLimitsFor = (groupId) => {
    const row = db.elective_limits.find((item) => item.group_id === groupId);
    return { ...defaultElectiveLimits, ...(row ? { catalog1_credits: row.catalog1_credits, catalog2_credits: row.catalog2_credits, max_disciplines: row.max_disciplines } : {}) };
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
  const id = (table, key) => Math.max(0, ...db[table].map((x) => x[key])) + 1;
  const fail = (status, message) => {
    throw Object.assign(new Error(message), { status });
  };
  const disciplineDetails = (value) => {
    if (typeof value.description !== "string" || value.description.length > 2000 || typeof value.syllabus_url !== "string" || value.syllabus_url.length > 2048) fail(422,"Опис має містити до 2000 символів, а посилання — до 2048.");
    const description = value.description.trim();
    const syllabus_url = value.syllabus_url.trim();
    if (syllabus_url) {
      let parsed;
      try { parsed = new URL(syllabus_url); } catch { fail(422,"Вкажіть повне посилання на силабус із https:// або http://."); }
      if (!["https:","http:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) fail(422,"Вкажіть безпечне посилання на силабус із https:// або http://.");
    }
    return { description, syllabus_url };
  };
  const audit = (actor, action, target, detail) => {
    db.audit_logs.push({ audit_id: id("audit_logs", "audit_id"), actor_id: actor.user_id, action, target, detail, at: new Date().toISOString() });
  };
  const assignmentGroupIds = (assignment) => assignment.roster_group_ids || (assignment.stream_id
    ? db.streams.find((s) => s.stream_id === assignment.stream_id)?.group_ids || []
    : assignment.group_id ? [assignment.group_id] : []);
  const eligibleForAssignment = (assignment, studentId) => {
    const student = db.users.find((u) => u.user_id === studentId && hasRole(u,"student"));
    if (!student || !assignment.roster_student_ids?.includes(studentId)) return false;
    const discipline = db.disciplines.find((d) => d.discipline_id === assignment.discipline_id);
    return !discipline?.is_elective || db.elective_enrollments.some((enrollment) => enrollment.student_id === studentId && enrollment.discipline_id === assignment.discipline_id && enrollment.semester_id === assignment.semester_id && enrollment.status === "approved");
  };
  const completed = (semesterId) => db.semesters.find((semester) => semester.semester_id === semesterId)?.end_date < currentDate();
  const debtCriteria = (assignment, studentId) => {
    const result = scoreBreakdown(db, assignment, studentId);
    if (!result.scheme) return { needsDebt:false, reason:"Ваги не встановлено", score:null };
    const examMissing = (result.scheme.weights["Екзамен"] || 0) > 0 && !db.lessons.some((lesson) => lesson.assignment_id === assignment.assignment_id && lesson.lesson_type === "Екзамен" && (!lesson.group_id || Number(assignment.student_group_ids?.[studentId]) === lesson.group_id) && db.grades.some((grade) => grade.lesson_id === lesson.lesson_id && grade.student_id === studentId));
    const lowScore = result.semesterScore < 50;
    return { needsDebt:lowScore || examMissing, reason:[lowScore ? `Підсумковий бал ${result.semesterScore} нижче 50` : null, examMissing ? "Немає оцінки обов’язкового екзамену" : null].filter(Boolean).join("; "), score:result.semesterScore };
  };
  let reconciledOn = null;
  const reconcileDebts = () => {
    reconciledOn = currentDate();
    let changed = false;
    for (const assignment of db.teaching_assignments.filter((item) => completed(item.semester_id))) for (const studentId of assignment.roster_student_ids || []) {
      if (!eligibleForAssignment(assignment, studentId)) continue;
      const criteria = debtCriteria(assignment, studentId);
      if (!criteria.needsDebt) continue;
      const row = db.debts.find((debt) => debt.student_id === studentId && debt.discipline_id === assignment.discipline_id && debt.semester_id === assignment.semester_id);
      if (!row) {
        const debt = { debt_id:id("debts","debt_id"), student_id:studentId, discipline_id:assignment.discipline_id, semester_id:assignment.semester_id, reason:criteria.reason, deadline:null, status:"open", source:"automatic", created_at:new Date().toISOString() };
        db.debts.push(debt);
        db.notifications.push({ notification_id:id("notifications","notification_id"), user_id:studentId, message:`Виникла академічна заборгованість: ${criteria.reason}. Термін ліквідації встановить деканат.`, is_read:false, created_at:new Date().toISOString() });
        changed = true;
      } else if (row.status === "closed" || row.reason !== criteria.reason) {
        if (row.status === "closed") { row.status = "open"; row.deadline = null; }
        row.reason = criteria.reason;
        changed = true;
      }
    }
    if (changed) persist();
  };
  reconcileDebts();
  const progressionPreview = (rawIds) => {
    const groupIds = Array.isArray(rawIds) ? [...new Set(rawIds.map(Number))] : [];
    if (!groupIds.length || groupIds.some((groupId) => !Number.isInteger(groupId))) fail(422, "Оберіть групи для переведення.");
    const groups = groupIds.map((groupId) => db.groups.find((group) => group.group_id === groupId && group.status === "active"));
    if (groups.some((group) => !group)) fail(422, "Оберіть активні групи.");
    if (groups.some((group) => group.course >= 6)) fail(422, "Шостий курс є останнім: переведення далі недоступне.");
    for (const stream of db.streams.filter((item) => item.status === "active")) if (stream.group_ids.some((id) => groupIds.includes(id)) && !stream.group_ids.every((id) => groupIds.includes(id))) fail(422, `Групи потоку «${stream.name}» потрібно перевести разом.`);
    const years = [...new Set(groups.map((group) => group.admission_year + group.course - 1))];
    if (years.length !== 1) fail(422, "Разом можна перевести групи лише одного навчального року.");
    const startYear = years[0] + 1;
    const nextYear = `${startYear}/${startYear+1}`;
    if (db.teaching_assignments.some((assignment) => db.semesters.find((semester) => semester.semester_id === assignment.semester_id)?.academic_year === nextYear && assignmentGroupIds(assignment).some((id) => groupIds.includes(id)))) fail(409, "На наступний навчальний рік уже є призначені дисципліни цих груп. Спочатку перевірте їх.");
    const rows = groups.map((group) => ({ group_id: group.group_id, name: group.name, faculty: group.faculty, admission_year: group.admission_year, course_before: group.course, course_after: group.course + 1, student_count: db.users.filter((user) => hasRole(user,"student") && user.group_id === group.group_id && user.status === "active").length }));
    for (const row of rows) {
      const nextName=row.name.replace(/-(\d)(\d+)$/, (match, course, suffix) => Number(course) === row.course_before ? `-${row.course_after}${suffix}` : match);
      if (db.groups.some((group) => group.status === "active" && group.faculty === row.faculty && group.name === nextName && !groupIds.includes(group.group_id))) fail(409,`Назва «${nextName}» вже зайнята активною групою. Спочатку випустіть відповідний курс.`);
    }
    const key = JSON.stringify({ groupIds:[...groupIds].sort((a,b)=>a-b), nextYear, courses:rows.map((row)=>[row.group_id,row.course_before]) });
    return { group_ids:groupIds, rows, next_academic_year:nextYear, new_semesters:[1,2].filter((term) => !db.semesters.some((semester) => semester.academic_year === nextYear && semester.term_number === term)), frozen_assignments:db.teaching_assignments.filter((assignment) => assignmentGroupIds(assignment).some((id) => groupIds.includes(id))).length, key };
  };
  const graduationPreview = (rawIds) => {
    const groupIds = Array.isArray(rawIds) ? [...new Set(rawIds.map(Number))].sort((a,b)=>a-b) : [];
    if (!groupIds.length || groupIds.some((groupId) => !Number.isInteger(groupId))) fail(422,"Оберіть групи для випуску.");
    const groups = groupIds.map((groupId) => db.groups.find((group) => group.group_id === groupId && group.status === "active"));
    if (groups.some((group) => !group)) fail(422,"Випустити можна лише активні групи.");
    if (groups.some((group) => ![4,6].includes(group.course))) fail(422,"Випуск доступний після 4-го або 6-го курсу.");
    if (new Set(groups.map((group) => `${group.admission_year}|${group.course}`)).size !== 1) fail(422,"Разом випускають групи одного року вступу та курсу.");
    for (const stream of db.streams.filter((item) => item.status === "active")) if (stream.group_ids.some((groupId) => groupIds.includes(groupId)) && !stream.group_ids.every((groupId) => groupIds.includes(groupId))) fail(422,`Групи потоку «${stream.name}» потрібно випустити разом.`);
    const startYear = groups[0].admission_year + groups[0].course - 1;
    const academicYear = `${startYear}/${startYear+1}`;
    const finalTerm = db.semesters.find((semester) => semester.academic_year === academicYear && semester.term_number === 2);
    const studentIds = db.users.filter((user) => hasRole(user,"student") && groupIds.includes(user.group_id) && user.student_status !== "graduated").map((user) => user.user_id);
    const heldIds = [...new Set(db.debts.filter((debt) => studentIds.includes(debt.student_id) && debt.status === "open").map((debt) => debt.student_id))];
    const blockers = [];
    if (!finalTerm) blockers.push(`Для ${academicYear} ще не створено 2 півріччя.`);
    else if (finalTerm.end_date >= currentDate()) blockers.push(`2 півріччя завершується ${finalTerm.end_date}; випуск доступний після цієї дати.`);
    const rows = groups.map((group) => {
      const students = db.users.filter((user) => hasRole(user,"student") && user.group_id === group.group_id && user.student_status !== "graduated");
      const graduates = students.filter((student) => !heldIds.includes(student.user_id));
      const held=students.filter((student)=>heldIds.includes(student.user_id));
      return { group_id:group.group_id, name:group.name, archived_name:`${group.name} (вип. ${startYear+1})`, faculty:group.faculty, course:group.course, admission_year:group.admission_year, student_count:students.length, graduate_ids:graduates.map((student)=>student.user_id), graduate_names:graduates.map((student)=>student.full_name), held_ids:held.map((student)=>student.user_id), held_names:held.map((student)=>student.full_name) };
    });
    if (!rows.some((row) => row.graduate_ids.length)) blockers.push("У вибраних групах немає студентів, які можуть випуститися.");
    const streams = db.streams.filter((stream) => stream.status === "active" && stream.group_ids.every((groupId) => groupIds.includes(groupId))).map((stream) => ({ stream_id:stream.stream_id, name:stream.name, archived_name:`${stream.name} (вип. ${startYear+1})` }));
    const key = JSON.stringify({ groupIds, academicYear, rows:rows.map((row)=>[row.group_id,row.name,row.course,row.graduate_ids,row.held_ids]), streams:streams.map((stream)=>stream.stream_id), blockers });
    return { group_ids:groupIds, academic_year:academicYear, graduation_year:startYear+1, course:groups[0].course, rows, streams, blockers, key };
  };
  return async function api(req, res, next = () => {}) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/")) return next();
    const send = (status, data) => {
      if (req.method !== "GET" && status < 400 && !url.pathname.startsWith("/api/auth/")) reconcileDebts();
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    try {
      // Навчальна ідентифікація. У production потрібна серверна сесія, а не заголовок.
      if (req.method === "POST" && url.pathname === "/api/auth/login") {
        let raw = "";
        for await (const chunk of req) { raw += chunk; if (raw.length > 10000) fail(413, "Завеликий запит."); }
        let credentials;
        try { credentials = JSON.parse(raw); } catch { fail(400, "Некоректні дані входу."); }
        const user = db.users.find((u) => u.email === String(credentials.email || "").trim().toLowerCase() && ["active","graduated"].includes(u.status));
        if (!user || !checkPassword(user, credentials.password)) fail(401, "Невірна університетська пошта або пароль.");
        const token = randomBytes(32).toString("hex");
        sessions.set(token, { user_id:user.user_id, role:user.role });
        return send(200, { token, user: { user_id: user.user_id, full_name: user.full_name, role: user.role, roles:user.roles, email: user.email } });
      }
      const token = /^Bearer ([a-f0-9]{64})$/.exec(String(req.headers.authorization || ""))?.[1];
      const session = token && sessions.get(token);
      const actorId = session?.user_id || (allowDemoHeader ? Number(req.headers["x-demo-user"] || 1) : null);
      const account = db.users.find((u) => u.user_id === actorId);
      const actor = account && (!session || account.roles.includes(session.role)) && { ...account, role:session?.role || account.role };
      if (!actor || (actor.status !== "active" && !(actor.status === "graduated" && actor.role === "student"))) fail(401, "Профіль недоступний.");
      if (reconciledOn !== currentDate()) reconcileDebts();
      if (req.method === "POST" && url.pathname === "/api/auth/logout") { if (token) sessions.delete(token); return send(200, { message: "Вихід виконано." }); }
      if (req.method === "POST" && url.pathname === "/api/auth/role") {
        let raw = "";
        for await (const chunk of req) { raw += chunk; if (raw.length > 1000) fail(413, "Завеликий запит."); }
        let selected;
        try { selected = JSON.parse(raw).role; } catch { fail(400,"Некоректна роль."); }
        if (!token || !account.roles.includes(selected) || (account.status === "graduated" && selected !== "student")) fail(403,"Ця роль не призначена вашому обліковому запису.");
        sessions.set(token,{user_id:account.user_id,role:selected});
        return send(200,{role:selected,roles:account.roles});
      }
      if (actor.role === "student" && actor.student_status === "graduated" && req.method !== "GET") fail(403,"Архівний профіль доступний лише для перегляду.");
      const canLesson = (lessonId) => {
        const l = db.lessons.find((x) => x.lesson_id === lessonId);
        const a = db.teaching_assignments.find(
          (x) => x.assignment_id === l?.assignment_id,
        );
        return (
          a &&
          actor.role === "teacher" && a.teacher_id === actor.user_id
        );
      };
      const visibleLesson = (lessonId) => {
        const l = db.lessons.find((x) => x.lesson_id === lessonId);
        const a = db.teaching_assignments.find(
          (x) => x.assignment_id === l?.assignment_id,
        );
        return actor.role !== "teacher" || a?.teacher_id === actor.user_id;
      };
      if (req.method === "GET" && url.pathname === "/api/bootstrap") {
        const own = structuredClone(db);
        own.me = { ...actor, password_hash: undefined };
        own.today = currentDate();
        own.elective_defaults = defaultElectiveLimits;
        delete own.rankings;
        const ownAssignments = db.teaching_assignments.filter((a) => a.teacher_id === actor.user_id);
        const visibleGroupIds = actor.role === "curator" ? (actor.curated_group_ids || []) : [actor.group_id];
        const groupStudents = db.users.filter((u) => hasRole(u,"student") && visibleGroupIds.includes(u.group_id)).map((u) => u.user_id);
        const lessonAllowed = (lessonId) => {
          const lesson = db.lessons.find((l) => l.lesson_id === lessonId);
          const assignment = db.teaching_assignments.find((a) => a.assignment_id === lesson?.assignment_id);
          if (actor.role === "teacher") return assignment?.teacher_id === actor.user_id;
          if (actor.role === "student") return assignment && eligibleForAssignment(assignment, actor.user_id) && (!lesson.group_id || Number(assignment.student_group_ids?.[actor.user_id]) === lesson.group_id);
          if (actor.role === "curator") return assignment && assignmentGroupIds(assignment).some((groupId) => visibleGroupIds.includes(groupId));
          return false;
        };
        if (actor.role === "student") {
          const rows = db.teaching_assignments.filter((a) => eligibleForAssignment(a, actor.user_id));
          const currentGroup = db.groups.find((group) => group.group_id === actor.group_id);
          own.elective_offerings = db.teaching_assignments.filter((assignment) => {
            const discipline = db.disciplines.find((item) => item.discipline_id === assignment.discipline_id);
            const semester = db.semesters.find((item) => item.semester_id === assignment.semester_id);
            return actor.student_status !== "graduated" && currentGroup?.status === "active" && discipline?.is_elective && discipline.status === "active" && semester && assignment.roster_group_ids.includes(currentGroup.group_id) && assignment.course_at_assignment === currentGroup.course && Number(semester.academic_year.slice(0,4)) === currentGroup.admission_year + currentGroup.course - 1 && discipline.semester_number === semesterNumber(currentGroup.course, semester.term_number);
          }).map((assignment) => ({ discipline_id:assignment.discipline_id, semester_id:assignment.semester_id, taken:db.elective_enrollments.filter((entry)=>entry.discipline_id===assignment.discipline_id&&entry.semester_id===assignment.semester_id&&entry.status!=="rejected").length }));
          own.teaching_assignments = rows;
          own.lessons = db.lessons.filter((l) => rows.some((a) => a.assignment_id === l.assignment_id && (!l.group_id || Number(a.student_group_ids?.[actor.user_id]) === l.group_id)));
          own.grades = db.grades.filter((g) => g.student_id === actor.user_id && lessonAllowed(g.lesson_id));
          own.attendance = db.attendance.filter((a) => a.student_id === actor.user_id && lessonAllowed(a.lesson_id));
          own.debts = db.debts.filter((d) => d.student_id === actor.user_id);
          own.elective_enrollments = db.elective_enrollments.filter((e) => e.student_id === actor.user_id);
          own.users = db.users.filter((u) => u.user_id === actor.user_id || hasRole(u,"teacher"));
          own.weight_schemes = db.weight_schemes.filter((w) => rows.some((a) => a.discipline_id === w.discipline_id && a.semester_id === w.semester_id && a.course_at_assignment === w.course));
          const visibleDisciplineIds = new Set([...rows.map((a) => a.discipline_id), ...own.elective_offerings.map((offering) => offering.discipline_id)]);
          const studentGroupIds = new Set([actor.group_id, ...rows.flatMap((a) => assignmentGroupIds(a))]);
          own.disciplines = db.disciplines.filter((d) => visibleDisciplineIds.has(d.discipline_id));
          own.my_elective_limits = electiveLimitsFor(actor.group_id);
          own.elective_usage = electiveUsage(actor.user_id);
          own.groups = db.groups.filter((g) => studentGroupIds.has(g.group_id));
          own.streams = db.streams.filter((s) => s.group_ids.some((groupId) => studentGroupIds.has(groupId)));
        } else if (actor.role === "teacher") {
          own.teaching_assignments = ownAssignments;
          own.lessons = db.lessons.filter((l) => ownAssignments.some((a) => a.assignment_id === l.assignment_id));
          own.grades = db.grades.filter((g) => lessonAllowed(g.lesson_id));
          own.attendance = db.attendance.filter((a) => lessonAllowed(a.lesson_id));
          own.debts = [];
          own.elective_enrollments = [];
          own.users = db.users.filter((u) => u.user_id === actor.user_id || (hasRole(u,"student") && ownAssignments.some((a) => a.roster_student_ids.includes(u.user_id))));
          own.weight_schemes = db.weight_schemes.filter((w) => ownAssignments.some((a) => a.discipline_id === w.discipline_id && a.semester_id === w.semester_id && a.course_at_assignment === w.course));
          own.assignment_student_ids = Object.fromEntries(ownAssignments.map((assignment) => [assignment.assignment_id, assignment.roster_student_ids.filter((studentId) => eligibleForAssignment(assignment, studentId))]));
        } else if (actor.role === "curator") {
          own.teaching_assignments = db.teaching_assignments.filter((a) => assignmentGroupIds(a).some((groupId) => visibleGroupIds.includes(groupId)));
          own.lessons = db.lessons.filter((l) => own.teaching_assignments.some((a) => a.assignment_id === l.assignment_id));
          own.grades = db.grades.filter((g) => groupStudents.includes(g.student_id) && lessonAllowed(g.lesson_id));
          own.attendance = db.attendance.filter((a) => groupStudents.includes(a.student_id) && lessonAllowed(a.lesson_id));
          own.debts = db.debts.filter((d) => groupStudents.includes(d.student_id));
          own.elective_enrollments = [];
          own.users = db.users.filter((u) => u.user_id === actor.user_id || groupStudents.includes(u.user_id) || (hasRole(u,"student") && own.teaching_assignments.some((a) => a.roster_student_ids.includes(u.user_id) && visibleGroupIds.includes(a.student_group_ids[u.user_id]))));
          own.weight_schemes = db.weight_schemes.filter((w) => own.teaching_assignments.some((a) => a.discipline_id === w.discipline_id && a.semester_id === w.semester_id && a.course_at_assignment === w.course));
        } else if (actor.role === "dean") {
          // Деканат бачить тільки свій факультет і не змінює оцінки.
          const facultyGroupIds = db.groups.filter((g) => g.faculty === actor.faculty).map((g) => g.group_id);
          own.groups = db.groups.filter((g) => facultyGroupIds.includes(g.group_id));
          own.streams = db.streams.filter((s) => s.group_ids.every((groupId) => facultyGroupIds.includes(groupId)));
          own.teaching_assignments = db.teaching_assignments.filter((a) => assignmentGroupIds(a).every((groupId) => facultyGroupIds.includes(groupId)));
          const ownAssignmentIds = new Set(own.teaching_assignments.map((a) => a.assignment_id));
          own.lessons = db.lessons.filter((l) => ownAssignmentIds.has(l.assignment_id));
          const ownLessonIds = new Set(own.lessons.map((l) => l.lesson_id));
          own.grades = db.grades.filter((g) => ownLessonIds.has(g.lesson_id));
          own.attendance = db.attendance.filter((a) => ownLessonIds.has(a.lesson_id));
          own.debts = db.debts.filter((d) => facultyGroupIds.includes(db.users.find((u) => u.user_id === d.student_id)?.group_id));
          own.elective_enrollments = db.elective_enrollments.filter((e) => facultyGroupIds.includes(db.users.find((u) => u.user_id === e.student_id)?.group_id));
          own.disciplines = db.disciplines.filter((d) => own.teaching_assignments.some((a) => a.discipline_id === d.discipline_id));
          own.users = db.users.filter((u) => u.user_id === actor.user_id || userFaculty(u) === actor.faculty);
          own.weight_schemes = db.weight_schemes.filter((w) => own.teaching_assignments.some((a) => a.discipline_id === w.discipline_id && a.semester_id === w.semester_id && a.course_at_assignment === w.course));
          own.group_promotions = (db.group_promotions || []).filter((promotion) => promotion.group_ids.every((groupId) => facultyGroupIds.includes(groupId)));
          own.graduations = db.graduations.filter((graduation) => graduation.rows.every((row) => facultyGroupIds.includes(row.group_id)));
        } else {
          own.elective_enrollments = [];
        }
        own.elective_limits = actor.role === "admin" ? db.elective_limits : actor.role === "dean" ? db.elective_limits.filter((item) => groupFaculty(item.group_id) === actor.faculty) : [];
        if (!["admin","dean"].includes(actor.role)) own.graduations = [];
        if (!["admin","dean"].includes(actor.role)) own.group_promotions = [];
        own.notifications = own.notifications.filter(
          (x) => x.user_id === actor.user_id,
        );
        own.grade_history = own.grade_history.filter((h) =>
          own.grades.some((g) => g.grade_id === h.grade_id),
        );
        own.grade_correction_requests = db.grade_correction_requests.filter((request) => actor.role === "admin" || actor.role === "dean" && userFaculty(db.users.find((user) => user.user_id === request.student_id)) === actor.faculty || actor.role === "teacher" && request.requested_by === actor.user_id);
        if (actor.role !== "admin") own.audit_logs = [];
        own.users = own.users.map(({ password_hash, ...user }) => user);
        return send(200, own);
      }
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 10000) fail(413, "Завеликий запит.");
      }
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        fail(400, "Некоректний JSON.");
      }
      const parts = url.pathname.split("/");
      const resource = parts[2],
        recordId = Number(parts[3]);
      if (resource === "disciplines" && parts[4] === "details" && req.method === "PATCH") {
        if (actor.role !== "teacher") fail(403,"Опис дисципліни редагує призначений викладач.");
        const discipline = db.disciplines.find((item) => item.discipline_id === recordId);
        if (!discipline) fail(404,"Дисципліну не знайдено.");
        if (!db.teaching_assignments.some((assignment) => assignment.discipline_id === recordId && assignment.teacher_id === actor.user_id)) fail(403,"Дисципліна не закріплена за вами.");
        Object.assign(discipline, disciplineDetails(body));
        audit(actor,"discipline.details.update",`discipline:${recordId}`,"Оновлено опис або посилання на силабус");
        persist();
        return send(200,discipline);
      }
      if (resource === "progression" && req.method === "POST") {
        if (!["admin","dean"].includes(actor.role)) fail(403, "Переведення виконує адміністратор або деканат.");
        const plan = progressionPreview(body.group_ids);
        if (actor.role === "dean" && plan.rows.some((row) => row.faculty !== actor.faculty)) fail(403,"Деканат може переводити лише групи свого факультету.");
        if (parts[3] === "preview") return send(200, plan);
        if (parts[3] !== "apply") fail(404, "Маршрут не знайдено.");
        if (body.preview_key !== plan.key) fail(409, "Дані змінилися. Перегляньте план ще раз.");
        for (const row of plan.rows) {
          const group = db.groups.find((item) => item.group_id === row.group_id);
          const oldName = group.name;
          group.course = row.course_after;
          group.name = oldName.replace(/-(\d)(\d+)$/, (match, course, suffix) => Number(course) === row.course_before ? `-${row.course_after}${suffix}` : match);
        }
        for (const stream of db.streams.filter((item) => item.group_ids.every((id) => plan.group_ids.includes(id)))) {
          const oldCourse = plan.rows.find((row) => row.group_id === stream.group_ids[0])?.course_before;
          stream.name = stream.name.replace(/-(\d)$/, (match, course) => Number(course) === oldCourse ? `-${oldCourse+1}` : match);
        }
        const startYear = Number(plan.next_academic_year.slice(0,4));
        for (const term of plan.new_semesters) db.semesters.push({ semester_id:id("semesters","semester_id"), academic_year:plan.next_academic_year, term_number:term, start_date:term===1?`${startYear}-09-01`:`${startYear+1}-02-01`, end_date:term===1?`${startYear}-12-31`:`${startYear+1}-06-30`, is_current:false });
        if (db.groups.filter((group) => group.status === "active").every((group) => group.admission_year + group.course - 1 >= startYear)) {
          db.semesters.forEach((semester) => { semester.is_current = false; });
          db.semesters.find((semester) => semester.academic_year === plan.next_academic_year && semester.term_number === 1).is_current = true;
        }
        db.group_promotions ||= [];
        db.group_promotions.push({ promotion_id:id("group_promotions","promotion_id"), actor_id:actor.user_id, at:new Date().toISOString(), group_ids:plan.group_ids, academic_year:plan.next_academic_year, rows:plan.rows });
        audit(actor,"groups.promote",`year:${plan.next_academic_year}`,plan.rows.map((row)=>`${row.name}: ${row.course_before}→${row.course_after}`).join("; "));
        persist();
        return send(200, plan);
      }
      if (resource === "graduations" && req.method === "POST") {
        if (!["admin","dean"].includes(actor.role)) fail(403,"Випуск виконує адміністратор або деканат.");
        const plan = graduationPreview(body.group_ids);
        if (actor.role === "dean" && plan.rows.some((row) => row.faculty !== actor.faculty)) fail(403,"Деканат може випускати лише групи свого факультету.");
        if (parts[3] === "preview") return send(200,plan);
        if (parts[3] !== "apply") fail(404,"Маршрут не знайдено.");
        if (body.preview_key !== plan.key) fail(409,"Дані змінилися. Перегляньте план ще раз.");
        if (plan.blockers.length) fail(409,plan.blockers.join(" "));
        const at = new Date().toISOString();
        for (const row of plan.rows) {
          const group = db.groups.find((item) => item.group_id === row.group_id);
          group.name = row.archived_name;
          group.status = "graduated";
          group.graduated_at = at;
          group.graduation_year = plan.graduation_year;
          for (const studentId of row.graduate_ids) {
            const student = db.users.find((user) => user.user_id === studentId);
            student.student_status = "graduated";
            student.graduated_at = at;
            student.status = student.roles.some((role) => role !== "student") ? "active" : "graduated";
          }
          for (const studentId of row.held_ids) db.users.find((user) => user.user_id === studentId).student_status = "repeat_pending";
        }
        for (const item of plan.streams) {
          const stream = db.streams.find((row) => row.stream_id === item.stream_id);
          stream.name = item.archived_name;
          stream.status = "graduated";
          stream.graduated_at = at;
        }
        db.graduations.push({ graduation_id:id("graduations","graduation_id"), actor_id:actor.user_id, at, academic_year:plan.academic_year, graduation_year:plan.graduation_year, course:plan.course, group_ids:plan.group_ids, rows:plan.rows, streams:plan.streams });
        db.group_promotions ||= [];
        db.group_promotions.push({ promotion_id:id("group_promotions","promotion_id"), actor_id:actor.user_id, at, group_ids:plan.group_ids, academic_year:plan.academic_year, rows:plan.rows.map((row)=>({ group_id:row.group_id, old_name:row.name, new_name:row.archived_name, from_course:row.course, to_course:null, new_status:"graduated" })) });
        audit(actor,"groups.graduate",`year:${plan.graduation_year}`,plan.rows.map((row)=>`${row.name}: випущено ${row.graduate_ids.length}, повторний курс ${row.held_ids.length}`).join("; "));
        persist();
        return send(200,plan);
      }
      if (resource === "weight_schemes" && req.method === "POST") {
        if (actor.role !== "teacher") fail(403, "Ваги встановлює викладач.");
        const disciplineId = Number(body.discipline_id), semesterId = Number(body.semester_id), course = Number(body.course);
        if (!Number.isInteger(course) || !db.teaching_assignments.some((a) => a.teacher_id === actor.user_id && a.discipline_id === disciplineId && a.semester_id === semesterId && a.course_at_assignment === course)) fail(403, "Дисципліна й курс не закріплені за викладачем.");
        if (completed(semesterId)) fail(409,"Півріччя завершено. Ваги заблоковані для звичайного редагування.");
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
          row = { scheme_id: id("weight_schemes", "scheme_id"), discipline_id: disciplineId, course, semester_id: semesterId, weights, updated_by: actor.user_id, updated_at: new Date().toISOString() };
          db.weight_schemes.push(row);
        }
        audit(actor, "weights.save", `discipline:${disciplineId};course:${course};semester:${semesterId}`, JSON.stringify(weights));
        persist();
        return send(200, row);
      }
      if (resource === "lessons" && req.method === "POST") {
        if (!["teacher","dean"].includes(actor.role)) fail(403, "Заняття створює викладач; історичний екзамен відновлює деканат.");
        const assignment = db.teaching_assignments.find((a) => a.assignment_id === Number(body.assignment_id) && (actor.role === "teacher" ? a.teacher_id === actor.user_id : a.roster_group_ids.some((groupId) => db.groups.find((group) => group.group_id === groupId)?.faculty === actor.faculty)));
        if (!assignment) fail(403, "Дисципліна не належить до вашої сфери доступу.");
        const historicExam = completed(assignment.semester_id) && actor.role === "dean" && body.lesson_type === "Екзамен";
        if (completed(assignment.semester_id) && !historicExam) fail(409,"Півріччя завершено. Історичний екзамен може відновити лише деканат.");
        if (!completed(assignment.semester_id) && actor.role !== "teacher") fail(403,"Поточні заняття створює викладач.");
        const semester = db.semesters.find((s) => s.semester_id === assignment.semester_id);
        const topic = String(body.topic || "").trim();
        if (topic.length < 3 || topic.length > 160) fail(422, "Вкажіть тему заняття (3–160 символів).");
        if (!lessonTypes.includes(body.lesson_type)) fail(422, "Оберіть тип заняття.");
        const maxScore = Number(body.max_score ?? defaultScale(body.lesson_type));
        if (!Number.isInteger(maxScore) || maxScore < 1 || maxScore > 100) fail(422, "Максимум заняття має бути цілим числом від 1 до 100.");
        const lessonGroupId = body.group_id == null ? null : Number(body.group_id);
        if (lessonGroupId && !assignment.roster_group_ids.includes(lessonGroupId)) fail(422,"Група не належить до цього призначення.");
        if (historicExam) {
          const reason = String(body.reason || "").trim();
          if (reason.length < 5 || reason.length > 255) fail(422,"Поясніть причину відновлення історичного екзамену (5–255 символів).");
          if (db.lessons.some((item) => item.assignment_id === assignment.assignment_id && item.lesson_type === "Екзамен" && (!item.group_id || !lessonGroupId || item.group_id === lessonGroupId))) fail(409,"Для вибраної групи вже існує екзаменаційне заняття.");
        }
        if (!isDate(body.lesson_date) || body.lesson_date < semester.start_date || body.lesson_date > semester.end_date) fail(422, "Дата має належати семестру.");
        const row = { lesson_id: id("lessons", "lesson_id"), assignment_id: assignment.assignment_id, group_id:lessonGroupId, lesson_date: body.lesson_date, lesson_type: body.lesson_type, max_score: maxScore, topic, ...(historicExam ? { approved_by:actor.user_id, retroactive_reason:String(body.reason).trim() } : {}) };
        db.lessons.push(row);
        db.users.filter((u) => hasRole(u,"student") && eligibleForAssignment(assignment, u.user_id) && (!lessonGroupId || Number(assignment.student_group_ids?.[u.user_id])===lessonGroupId) && u.status === "active").forEach((u) => db.attendance.push({ attendance_id: id("attendance", "attendance_id"), student_id: u.user_id, lesson_id: row.lesson_id, status: "unmarked", reason: null }));
        audit(actor, historicExam ? "lesson.retroactive_exam" : "lesson.create", `lesson:${row.lesson_id}`, historicExam ? `${topic}; ${row.retroactive_reason}` : topic);
        persist();
        return send(201, row);
      }
      if (resource === "grades" && ["POST", "PATCH"].includes(req.method)) {
        const previous =
          req.method === "PATCH"
            ? db.grades.find((x) => x.grade_id === recordId)
            : null;
        if (req.method === "PATCH" && !previous)
          fail(404, "Оцінку не знайдено.");
        const lessonId = previous?.lesson_id ?? Number(body.lesson_id),
          studentId = previous?.student_id ?? Number(body.student_id);
        if (!canLesson(lessonId))
          fail(403, "Немає права редагувати це заняття.");
        const lesson = db.lessons.find((l) => l.lesson_id === lessonId),
          assignment = db.teaching_assignments.find(
            (a) => a.assignment_id === lesson.assignment_id,
          );
        if (completed(assignment.semester_id)) fail(409,"Півріччя завершено. Подайте запит на виправлення оцінки до деканату.");
        if (
          !db.users.some(
            (u) =>
              u.user_id === studentId &&
              hasRole(u,"student") &&
              eligibleForAssignment(assignment, u.user_id) && (!lesson.group_id || Number(assignment.student_group_ids?.[u.user_id])===lesson.group_id),
          )
        )
          fail(422, "Студент не належить до групи заняття.");
        if (
          typeof body.value !== "number" ||
          !Number.isInteger(body.value) ||
          body.value < 0 ||
          body.value > (lesson.max_score || 100)
        )
          fail(422, `Введіть ціле число від 0 до ${lesson.max_score || 100}.`);
        if (
          previous &&
          (!(typeof body.reason === "string") ||
            body.reason.trim().length < 5 ||
            body.reason.trim().length > 255)
        )
          fail(422, "Причина виправлення має містити від 5 до 255 символів.");
        if (
          !previous &&
          db.grades.some(
            (g) => g.student_id === studentId && g.lesson_id === lessonId,
          )
        )
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
        db.notifications.push({ notification_id: id("notifications", "notification_id"), user_id: studentId, message: `Нову оцінку ${body.value} внесено до журналу.`, is_read: false, created_at: now });
        persist();
        return send(previous ? 200 : 201, { message: "Оцінку збережено." });
      }
      if (resource === "grade_corrections" && req.method === "POST") {
        if (actor.role !== "teacher") fail(403,"Запит на виправлення подає викладач.");
        const lesson = db.lessons.find((item) => item.lesson_id === Number(body.lesson_id));
        const assignment = db.teaching_assignments.find((item) => item.assignment_id === lesson?.assignment_id && item.teacher_id === actor.user_id);
        const studentId = Number(body.student_id);
        if (!assignment || !eligibleForAssignment(assignment,studentId) || lesson.group_id && Number(assignment.student_group_ids?.[studentId]) !== lesson.group_id) fail(403,"Це заняття не закріплене за викладачем і студентом.");
        if (!completed(assignment.semester_id)) fail(409,"Поки півріччя триває, оцінку можна змінити без запиту до деканату.");
        if (!Number.isInteger(body.proposed_value) || body.proposed_value < 0 || body.proposed_value > (lesson.max_score||100)) fail(422,`Введіть ціле число від 0 до ${lesson.max_score||100}.`);
        const reason=String(body.reason||"").trim();
        if (reason.length < 5 || reason.length > 255) fail(422,"Поясніть причину виправлення (5–255 символів).");
        const existing=db.grades.find((grade)=>grade.lesson_id===lesson.lesson_id&&grade.student_id===studentId);
        if (existing?.value === body.proposed_value) fail(409,"Запропонований бал збігається з наявним.");
        if (db.grade_correction_requests.some((request)=>request.lesson_id===lesson.lesson_id&&request.student_id===studentId&&request.status==="pending")) fail(409,"Для цього заняття й студента вже є запит на розгляді.");
        const row={ request_id:id("grade_correction_requests","request_id"), lesson_id:lesson.lesson_id, student_id:studentId, proposed_value:body.proposed_value, previous_value:existing?.value??null, reason, requested_by:actor.user_id, requested_at:new Date().toISOString(), status:"pending" };
        db.grade_correction_requests.push(row);
        audit(actor,"grade_correction.request",`request:${row.request_id}`,`${row.previous_value??"—"} → ${row.proposed_value}; ${reason}`);
        persist();
        return send(201,row);
      }
      if (resource === "grade_corrections" && req.method === "PATCH") {
        if (actor.role !== "dean") fail(403,"Запит розглядає деканат.");
        const row=db.grade_correction_requests.find((request)=>request.request_id===recordId);
        if (!row) fail(404,"Запит не знайдено.");
        if (userFaculty(db.users.find((user)=>user.user_id===row.student_id)) !== actor.faculty) fail(403,"Студент належить іншому факультету.");
        if (row.status!=="pending" || !["approved","rejected"].includes(body.status)) fail(422,"Можна затвердити або відхилити лише запит на розгляді.");
        if (body.status==="approved") {
          const existing=db.grades.find((grade)=>grade.lesson_id===row.lesson_id&&grade.student_id===row.student_id);
          if ((existing?.value??null)!==row.previous_value) fail(409,"Оцінка змінилася після подання запиту. Потрібен новий запит.");
          const now=new Date().toISOString();
          if (existing) {
            db.grade_history.push({ history_id:id("grade_history","history_id"), grade_id:existing.grade_id, old_value:existing.value, new_value:row.proposed_value, changed_by:actor.user_id, requested_by:row.requested_by, changed_at:now, reason:row.reason });
            existing.value=row.proposed_value; existing.updated_at=now;
          } else db.grades.push({ grade_id:id("grades","grade_id"), student_id:row.student_id, lesson_id:row.lesson_id, value:row.proposed_value, recorded_by:row.requested_by, approved_by:actor.user_id, given_at:now, updated_at:now });
          db.notifications.push({ notification_id:id("notifications","notification_id"), user_id:row.student_id, message:`Деканат погодив виправлення оцінки: ${row.proposed_value}.`, is_read:false, created_at:now });
        }
        row.status=body.status; row.reviewed_by=actor.user_id; row.reviewed_at=new Date().toISOString();
        audit(actor,`grade_correction.${body.status}`,`request:${row.request_id}`,`${row.previous_value??"—"} → ${row.proposed_value}; ${row.reason}`);
        reconcileDebts();
        persist();
        return send(200,row);
      }
      if (resource === "attendance" && req.method === "PATCH") {
        const row = db.attendance.find((x) => x.attendance_id === recordId);
        if (!row) fail(404, "Запис не знайдено.");
        if (!canLesson(row.lesson_id))
          fail(403, "Немає права редагувати відвідуваність.");
        if (completed(db.teaching_assignments.find((assignment) => assignment.assignment_id === db.lessons.find((lesson) => lesson.lesson_id === row.lesson_id)?.assignment_id)?.semester_id)) fail(409,"Півріччя завершено. Відвідуваність заблокована.");
        if (!["present", "absent"].includes(body.status))
          fail(422, "Оберіть присутність або пропуск.");
        if (
          body.status === "absent" &&
          !["поважна", "неповажна"].includes(body.reason)
        )
          fail(422, "Оберіть причину пропуску.");
        const changed = row.status !== body.status || row.reason !== (body.status === "present" ? null : body.reason);
        Object.assign(row, {
          status: body.status,
          reason: body.status === "present" ? null : body.reason,
        });
        audit(actor, "attendance.update", `attendance:${recordId}`, `${row.status}${row.reason ? ": " + row.reason : ""}`);
        if (changed && row.status === "absent") db.notifications.push({ notification_id: id("notifications", "notification_id"), user_id: row.student_id, message: "У журналі відмічено пропуск заняття (" + row.reason + ").", is_read: false, created_at: new Date().toISOString() });
        persist();
        return send(200, row);
      }
      if (resource === "elective_enrollments" && req.method === "POST") {
        if (actor.role !== "student") fail(403, "Заявку подає студент.");
        if (actor.student_status === "graduated" || db.groups.find((group) => group.group_id === actor.group_id)?.status !== "active") fail(403,"Запис доступний лише студентам активних груп.");
        const d = db.disciplines.find(
          (x) =>
            x.discipline_id === Number(body.discipline_id) &&
            x.is_elective &&
            x.status === "active",
        );
        const s = db.semesters.find(
          (x) => x.semester_id === Number(body.semester_id),
        );
        const eligibleAssignment = db.teaching_assignments.find((assignment) => assignment.discipline_id === d?.discipline_id && assignment.semester_id === s?.semester_id && assignment.roster_group_ids.includes(actor.group_id) && assignment.course_at_assignment === db.groups.find((group) => group.group_id === actor.group_id)?.course);
        if (!d || !s || !eligibleAssignment || d.semester_number !== semesterNumber(eligibleAssignment.course_at_assignment, s.term_number))
          fail(422, "Дисципліна недоступна в обраному семестрі.");
        if (d.enrollment_start && currentDate() < d.enrollment_start) fail(409, "Запис на дисципліну ще не розпочався.");
        if (d.enrollment_deadline && currentDate() > d.enrollment_deadline) fail(409, "Термін запису завершився.");
        if (d.capacity && db.elective_enrollments.filter((e) => e.discipline_id === d.discipline_id && e.semester_id === s.semester_id && e.status !== "rejected").length >= d.capacity) fail(409, "Місця закінчилися.");
        const previousRequest = db.elective_enrollments.find(
          (e) =>
            e.student_id === actor.user_id &&
            e.discipline_id === d.discipline_id &&
            e.semester_id === s.semester_id,
        );
        if (previousRequest && previousRequest.status !== "rejected") fail(409, "Заявку вже подано.");
        const limits = electiveLimitsFor(actor.group_id), usage = electiveUsage(actor.user_id);
        if (usage.total >= limits.max_disciplines) fail(409, `Досягнуто загальний ліміт вибіркових дисциплін: ${limits.max_disciplines}.`);
        if (d.catalog === 1 && usage.catalog1_credits + d.credits > limits.catalog1_credits) fail(409, `Перевищено ліміт кредитів 1 каталогу: використано ${usage.catalog1_credits} із ${limits.catalog1_credits}, а дисципліна має ${d.credits}.`);
        if (d.catalog === 2 && usage.catalog2_credits + d.credits > limits.catalog2_credits) fail(409, `Перевищено ліміт кредитів 2 каталогу: використано ${usage.catalog2_credits} із ${limits.catalog2_credits}, а дисципліна має ${d.credits}.`);
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
        persist();
        return send(201, row);
      }
      if (resource === "elective_enrollments" && req.method === "DELETE") {
        if (actor.student_status === "graduated") fail(403,"Архівний профіль доступний лише для перегляду.");
        const row = db[resource].find((x) => x.enrollment_id === recordId);
        if (!row) fail(404, "Заявку не знайдено.");
        if (userFaculty(db.users.find((u) => u.user_id === row.student_id)) !== actor.faculty) fail(403,"Заявка належить іншому факультету.");
        if (row.student_id !== actor.user_id || row.status !== "pending")
          fail(403, "Можна скасувати лише власну заявку, що очікує розгляду.");
        db[resource] = db[resource].filter((x) => x.enrollment_id !== recordId);
        audit(actor, "elective.cancel", `enrollment:${recordId}`, "");
        persist();
        return send(200, { message: "Заявку скасовано." });
      }
      if (resource === "elective_enrollments" && req.method === "PATCH") {
        if (actor.role !== "dean")
          fail(403, "Недостатньо прав.");
        const row = db[resource].find((x) => x.enrollment_id === recordId);
        if (!row) fail(404, "Заявку не знайдено.");
        if (userFaculty(db.users.find((u) => u.user_id === row.student_id)) !== actor.faculty) fail(403,"Заявка належить іншому факультету.");
        if (!["approved", "rejected"].includes(body.status))
          fail(422, "Некоректний статус.");
        const statusChanged = row.status !== body.status;
        row.status = body.status;
        if (statusChanged) db.notifications.push({ notification_id: id("notifications", "notification_id"), user_id: row.student_id, message: `Заявку на вибіркову дисципліну «${db.disciplines.find((item) => item.discipline_id === row.discipline_id)?.name || ""}» ${row.status === "approved" ? "підтверджено" : "відхилено"} деканатом.`, is_read: false, created_at: new Date().toISOString() });
        if (row.status === "approved") for (const assignment of db.teaching_assignments.filter((a) => a.discipline_id === row.discipline_id && a.semester_id === row.semester_id && assignmentGroupIds(a).includes(db.users.find((u) => u.user_id === row.student_id)?.group_id))) {
          if (!assignment.roster_student_ids.includes(row.student_id)) assignment.roster_student_ids.push(row.student_id);
          assignment.student_group_ids[row.student_id] = db.users.find((u) => u.user_id === row.student_id)?.group_id;
          for (const lesson of db.lessons.filter((l) => l.assignment_id === assignment.assignment_id && (!l.group_id || Number(assignment.student_group_ids?.[row.student_id])===l.group_id))) if (!db.attendance.some((a) => a.student_id === row.student_id && a.lesson_id === lesson.lesson_id)) db.attendance.push({ attendance_id: id("attendance", "attendance_id"), student_id: row.student_id, lesson_id: lesson.lesson_id, status: "unmarked", reason: null });
        }
        audit(actor, "elective." + body.status, `enrollment:${recordId}`, "");
        persist();
        return send(200, row);
      }
      if (resource === "debts" && req.method === "PATCH") {
        const row = db.debts.find((x) => x.debt_id === recordId);
        if (!row) fail(404, "Заборгованість не знайдено.");
        if (actor.role !== "dean" || userFaculty(db.users.find((user) => user.user_id === row.student_id)) !== actor.faculty) fail(403, "Термін і статус боргу визначає деканат свого факультету.");
        const nextDeadline = Object.hasOwn(body,"deadline") ? body.deadline : row.deadline;
        if (Object.hasOwn(body,"deadline")) {
          const semester = db.semesters.find((item) => item.semester_id === row.semester_id);
          if (!isDate(nextDeadline) || nextDeadline <= semester.end_date) fail(422,"Термін ліквідації має бути після завершення півріччя.");
        }
        if (Object.hasOwn(body,"status")) {
          if (body.status !== "closed" || row.status !== "open") fail(422,"Деканат може закрити лише відкритий борг.");
          const assignment = db.teaching_assignments.find((item) => item.discipline_id === row.discipline_id && item.semester_id === row.semester_id && item.roster_student_ids.includes(row.student_id));
          if (!assignment || !nextDeadline || debtCriteria(assignment,row.student_id).needsDebt) fail(409,"Борг можна закрити після встановлення терміну, бала не нижче 50 і оцінки обов’язкового екзамену.");
          row.status = "closed";
          row.closed_at = new Date().toISOString();
          db.notifications.push({ notification_id:id("notifications","notification_id"), user_id:row.student_id, message:"Академічну заборгованість ліквідовано.", is_read:false, created_at:new Date().toISOString() });
        }
        if (Object.hasOwn(body,"deadline")) {
          row.deadline = nextDeadline;
          db.notifications.push({ notification_id:id("notifications","notification_id"), user_id:row.student_id, message:`Термін ліквідації заборгованості: ${row.deadline}.`, is_read:false, created_at:new Date().toISOString() });
        }
        audit(actor, "debt.update", `debt:${recordId}`, `${row.status}; термін ${row.deadline||"не встановлено"}`);
        persist();
        return send(200, row);
      }
      if (resource === "notifications" && req.method === "PATCH") {
        const row = db.notifications.find(
          (x) => x.notification_id === recordId && x.user_id === actor.user_id,
        );
        if (!row) fail(404, "Сповіщення не знайдено.");
        row.is_read = true;
        persist();
        return send(200, row);
      }
      if (resource === "elective_limits" && req.method === "POST") {
        if (!["admin","dean"].includes(actor.role)) fail(403, "Ліміти вибіркових задає деканат або адміністратор.");
        const group = db.groups.find((item) => item.group_id === Number(body.group_id) && item.status === "active");
        if (!group) fail(422, "Оберіть активну групу.");
        if (actor.role === "dean" && group.faculty !== actor.faculty) fail(403, "Група належить іншому факультету.");
        const limits = {};
        for (const [field, max] of [["catalog1_credits", 60], ["catalog2_credits", 60], ["max_disciplines", 30]]) {
          const number = body[field];
          if (!Number.isInteger(number) || number < 0 || number > max) fail(422, `Поле «${field}» має бути цілим числом від 0 до ${max}.`);
          limits[field] = number;
        }
        let row = db.elective_limits.find((item) => item.group_id === group.group_id);
        const stamp = { updated_by: actor.user_id, updated_at: new Date().toISOString() };
        if (row) Object.assign(row, limits, stamp);
        else { row = { limit_id: id("elective_limits", "limit_id"), group_id: group.group_id, ...limits, ...stamp }; db.elective_limits.push(row); }
        audit(actor, "elective_limits.save", `group:${group.group_id}`, `1 каталог ${limits.catalog1_credits} кр.; 2 каталог ${limits.catalog2_credits} кр.; усього дисциплін ${limits.max_disciplines}`);
        persist();
        return send(200, row);
      }
      const adminTables = {
        users: "user_id", disciplines: "discipline_id",
        groups: "group_id", streams: "stream_id", semesters: "semester_id",
      };
      if (adminTables[resource] && ["POST", "PATCH"].includes(req.method)) {
        if (!["admin","dean"].includes(actor.role) || (actor.role === "dean" && resource === "semesters")) fail(403, "Недостатньо прав на довідник.");
        const key = adminTables[resource];
        const row = req.method === "PATCH" ? db[resource].find((x) => x[key] === recordId) : null;
        if (req.method === "PATCH" && !row) fail(404, "Запис не знайдено.");
        if (row?.status === "graduated") fail(409,"Архівний запис не редагується. Історію збережено.");
        if (actor.role === "dean" && row) {
          const inFaculty = resource === "users" ? userFaculty(row) === actor.faculty
            : resource === "groups" ? row.faculty === actor.faculty
            : resource === "streams" ? row.group_ids.every((groupId) => groupFaculty(groupId) === actor.faculty)
            : resource === "disciplines" ? db.teaching_assignments.some((assignment) => assignment.discipline_id === row.discipline_id) && db.teaching_assignments.filter((assignment) => assignment.discipline_id === row.discipline_id).every((assignment) => assignmentGroupIds(assignment).every((groupId) => groupFaculty(groupId) === actor.faculty))
            : false;
          if (!inFaculty) fail(403,"Запис належить іншому факультету.");
        }
        const allowedFields = {
          users: ["full_name", "email", "role", "roles", "group_id", "curated_group_ids", "faculty", "status"],
          disciplines: ["name", "description", "syllabus_url", "credits", "semester_number", "is_elective", "catalog", "capacity", "enrollment_start", "enrollment_deadline", "status"],
          groups: ["name", "course", "admission_year", "faculty", "specialty", "status"],
          streams: ["name", "group_ids", "status"],
          semesters: ["academic_year", "term_number", "start_date", "end_date", "is_current"],
        };
        const value = { ...(row || {}) };
        for (const field of allowedFields[resource]) if (Object.hasOwn(body, field)) value[field] = body[field];
        if (resource === "users") {
          value.full_name = String(value.full_name || "").trim();
          value.email = String(value.email || "").trim().toLowerCase();
          if (value.full_name.length < 3 || !/^[^\s@]+@pnu\.edu\.ua$/.test(value.email)) fail(422, "Вкажіть ПІБ і унікальну університетську пошту @pnu.edu.ua.");
          if (db.users.some((u) => u.email === value.email && u.user_id !== row?.user_id)) fail(409, "Цю адресу вже зареєстровано.");
          value.roles = Object.hasOwn(body,"roles") ? (Array.isArray(body.roles) ? [...new Set(body.roles)] : []) : Object.hasOwn(body,"role") ? [body.role] : value.roles || [value.role];
          if (!Array.isArray(value.roles) || !value.roles.length || value.roles.some((role) => !roles.includes(role)) || !["active", "inactive"].includes(value.status || "active")) fail(422, "Оберіть щонайменше одну коректну роль і статус.");
          if (actor.role === "dean" && value.roles.some((role) => ["dean","admin"].includes(role))) fail(403,"Призначення ролей деканату й адміністратора доступне лише адміністратору.");
          value.role = value.roles.includes(value.role) ? value.role : value.roles[0];
          if (hasRole(value,"student") && !db.groups.some((g) => g.group_id === Number(value.group_id))) fail(422, "Оберіть наявну групу.");
          if (hasRole(value,"student") && row && Number(value.group_id) !== row.group_id) {
            if (row.student_status === "graduated") fail(409,"Випускника не можна перевести. Історія зберігається в архіві.");
            const destination = db.groups.find((group) => group.group_id === Number(value.group_id) && group.status === "active");
            if (!destination) fail(422,"Перевести студента можна лише до активної групи.");
            if (row.student_status === "repeat_pending") {
              const previous = db.groups.find((group) => group.group_id === row.group_id);
              if (!previous || destination.course !== previous.course || destination.specialty !== previous.specialty || destination.faculty !== previous.faculty || destination.admission_year + destination.course - 1 <= previous.admission_year + previous.course - 1) fail(422,"Для повторного курсу оберіть активну групу того самого курсу, спеціальності й факультету в новому навчальному році.");
              value.student_status = "active";
              value.repeat_of_group_id = previous.group_id;
              value.repeat_started_at = new Date().toISOString();
            }
          }
          if (hasRole(value,"curator")) {
            if (!Array.isArray(value.curated_group_ids) || !value.curated_group_ids.length || value.curated_group_ids.some((groupId) => !Number.isInteger(groupId) || !db.groups.some((g) => g.group_id === groupId))) fail(422, "Оберіть щонайменше одну групу куратора.");
            value.curated_group_ids = [...new Set(value.curated_group_ids)];
          } else value.curated_group_ids = [];
          if (row?.user_id === actor.user_id && value.status === "inactive") fail(409, "Не можна деактивувати власний профіль.");
          value.group_id = hasRole(value,"student") ? Number(value.group_id) : null;
          value.faculty = hasRole(value,"student") ? groupFaculty(value.group_id) : String(value.faculty || "").trim();
          if (!faculties.includes(value.faculty)) fail(422,"Оберіть факультет зі списку університету.");
          if (actor.role === "dean" && (value.faculty !== actor.faculty || value.curated_group_ids.some((groupId) => groupFaculty(groupId) !== actor.faculty))) fail(403,"Обліковий запис має належати вашому факультету.");
        } else if (resource === "disciplines") {
          Object.assign(value, disciplineDetails({ description: value.description ?? "", syllabus_url: value.syllabus_url ?? "" }));
          value.name = String(value.name || "").trim();
          value.credits = Number(value.credits);
          value.semester_number = Number(value.semester_number);
          value.is_elective = Boolean(value.is_elective);
          value.catalog = value.is_elective ? Number(value.catalog) : null;
          if (value.is_elective && ![1, 2, 3].includes(value.catalog)) fail(422, "Оберіть каталог вибіркової дисципліни: 1, 2 або 3.");
          if (row && value.semester_number !== row.semester_number && db.teaching_assignments.some((assignment) => assignment.discipline_id === row.discipline_id)) fail(409, "Номер семестру закріпленої дисципліни не змінюється. Створіть нове призначення для іншого курсу.");
          if (value.name.length < 3 || !Number.isInteger(value.credits) || value.credits < 1 || value.credits > 30 || !Number.isInteger(value.semester_number) || value.semester_number < 1 || value.semester_number > 12) fail(422, "Перевірте назву, кредити та номер семестру.");
          if (value.is_elective && (!Number.isInteger(Number(value.capacity)) || Number(value.capacity) < 1 || !isDate(value.enrollment_start) || !isDate(value.enrollment_deadline) || value.enrollment_start > value.enrollment_deadline)) fail(422, "Для вибіркової дисципліни потрібні ліміт місць і коректний період запису.");
          value.capacity = value.is_elective ? Number(value.capacity) : null;
          value.enrollment_start = value.is_elective ? value.enrollment_start : null;
          value.enrollment_deadline = value.is_elective ? value.enrollment_deadline : null;
          value.status ||= "active";
        } else if (resource === "groups") {
          value.name = String(value.name || "").trim();
          value.course = Number(value.course);
          value.admission_year = Number(value.admission_year);
          if (value.name.length < 2 || !Number.isInteger(value.course) || value.course < 1 || value.course > 6 || !Number.isInteger(value.admission_year)) fail(422, "Перевірте назву, курс і рік вступу.");
          value.faculty = String(value.faculty || "").trim();
          value.specialty = String(value.specialty || "").trim();
          if (value.specialty.length < 3) fail(422, "Вкажіть спеціальність групи.");
          if (!faculties.includes(value.faculty)) fail(422, "Оберіть факультет зі списку університету.");
          if (actor.role === "dean" && value.faculty !== actor.faculty) fail(403,"Група належить іншому факультету.");
          if (db.groups.some((group) => group.group_id !== row?.group_id && group.status === "active" && group.faculty === value.faculty && group.name === value.name)) fail(409,"Назва групи вже використовується активною групою факультету.");
          if (row && value.course !== row.course) fail(409, "Курс наявної групи змінюється через сторінку переведення.");
          value.status ||= "active";
          if (row && db.streams.some((s) => s.group_ids.includes(row.group_id) && s.group_ids.some((otherId) => {
            const other = db.groups.find((g) => g.group_id === otherId);
            return otherId !== row.group_id && (other.course !== value.course || other.admission_year !== value.admission_year || other.specialty !== value.specialty || other.faculty !== value.faculty);
          }))) fail(409, "Група у потоці повинна зберігати той самий курс, рік вступу й спеціальність.");
        } else if (resource === "streams") {
          value.name = String(value.name || "").trim();
          value.group_ids = Array.isArray(value.group_ids) ? [...new Set(value.group_ids.map(Number))] : [];
          if (value.name.length < 3 || value.group_ids.length < 2 || value.group_ids.some((groupId) => !Number.isInteger(groupId) || !db.groups.some((g) => g.group_id === groupId && g.status === "active"))) fail(422, "Потік має містити щонайменше дві активні групи.");
          const groups = value.group_ids.map((groupId) => db.groups.find((g) => g.group_id === groupId));
          if (groups.some((g) => g.course !== groups[0].course || g.admission_year !== groups[0].admission_year || g.specialty !== groups[0].specialty || g.faculty !== groups[0].faculty)) fail(422, "У потоці можуть бути лише групи одного курсу, року вступу, спеціальності та факультету.");
          if (actor.role === "dean" && groups.some((g) => g.faculty !== actor.faculty)) fail(403,"Потік має складатися з груп вашого факультету.");
          value.status ||= "active";
          if (row) {
            const removed = row.group_ids.filter((groupId) => !value.group_ids.includes(groupId));
            if (removed.length && db.teaching_assignments.some((a) => a.stream_id === row.stream_id)) fail(409, "Групу не можна вилучити з потоку, який уже має призначені дисципліни. Створіть новий потік для наступного півріччя.");
          }
        } else {
          value.academic_year = String(value.academic_year || "").trim();
          value.term_number = Number(value.term_number);
          if (!/^\d{4}\/\d{4}$/.test(value.academic_year) || ![1,2].includes(value.term_number) || !isDate(value.start_date) || !isDate(value.end_date) || value.start_date >= value.end_date) fail(422, "Перевірте навчальний рік, тип і дати семестру.");
          if (db.semesters.some((s) => s.semester_id !== row?.semester_id && s.academic_year === value.academic_year && s.term_number === value.term_number)) fail(409, "Це півріччя навчального року вже існує.");
          value.is_current = Boolean(value.is_current);
        }
        let newAssignment = null;
        if (resource === "disciplines" && !row) {
          const input = body.assignment || {};
          const teacher = db.users.find((u) => u.user_id === Number(input.teacher_id) && hasRole(u,"teacher") && u.status === "active");
          const sem = db.semesters.find((s) => s.semester_id === Number(input.semester_id));
          const targetType = input.target_type;
          const group = targetType === "group" ? db.groups.find((g) => g.group_id === Number(input.group_id) && g.status === "active") : null;
          const stream = targetType === "stream" ? db.streams.find((s) => s.stream_id === Number(input.stream_id) && s.status === "active") : null;
          if (!teacher || !sem || (targetType !== "group" && targetType !== "stream") || (!group && !stream)) fail(422, "Оберіть викладача, семестр та активну групу або потік.");
          const targetGroup = group || db.groups.find((g) => g.group_id === stream.group_ids[0]);
          if (actor.role === "dean" && (targetGroup.faculty !== actor.faculty || userFaculty(teacher) !== actor.faculty)) fail(403,"Призначення має належати вашому факультету.");
          if (value.semester_number !== targetGroup.course * 2 - (sem.term_number === 1 ? 1 : 0)) fail(422, "Номер семестру дисципліни не відповідає курсу групи або потоку.");
          if (Number(sem.academic_year.slice(0,4)) !== targetGroup.admission_year + targetGroup.course - 1) fail(422, "Навчальний рік не відповідає курсу та року вступу групи.");
          const rosterGroups = group ? [group.group_id] : [...stream.group_ids];
          const rosterStudents = value.is_elective ? [] : db.users.filter((u) => hasRole(u,"student") && u.status === "active" && rosterGroups.includes(u.group_id)).map((u) => u.user_id);
          newAssignment = { assignment_id: id("teaching_assignments", "assignment_id"), teacher_id: teacher.user_id, discipline_id: null, group_id: group?.group_id || null, stream_id: stream?.stream_id || null, semester_id: sem.semester_id, course_at_assignment: targetGroup.course, roster_group_ids: rosterGroups, roster_student_ids: rosterStudents, student_group_ids: Object.fromEntries(rosterStudents.map((studentId) => [studentId, db.users.find((u) => u.user_id === studentId)?.group_id])), roster_group_names: Object.fromEntries(rosterGroups.map((groupId) => [groupId, db.groups.find((g) => g.group_id === groupId)?.name])), target_name_at_assignment: group?.name || stream?.name };
        }
        const streamAdded = resource === "streams" && row ? value.group_ids.filter((groupId) => !row.group_ids.includes(groupId)) : [];
        if (resource === "semesters" && value.is_current) db.semesters.forEach((s) => { s.is_current = false; });
        const oldGroupId = resource === "users" ? row?.group_id : null;
        if (row) Object.assign(row, value);
        else { value[key] = id(resource, key); db[resource].push(value); }
        if (resource === "groups" && !row) {
          const year = value.admission_year + value.course - 1;
          for (const term of [1,2]) if (!db.semesters.some((semester) => semester.academic_year === `${year}/${year+1}` && semester.term_number === term)) db.semesters.push({ semester_id:id("semesters","semester_id"), academic_year:`${year}/${year+1}`, term_number:term, start_date:term===1?`${year}-09-01`:`${year+1}-02-01`, end_date:term===1?`${year}-12-31`:`${year+1}-06-30`, is_current:false });
        }
        if (resource === "users" && !row) {
          value.password_hash = passwordHash(value.user_id);
          if (hasRole(value,"student")) for (const assignment of db.teaching_assignments.filter((a) => a.roster_group_ids.includes(value.group_id) && !db.disciplines.find((d) => d.discipline_id === a.discipline_id)?.is_elective && db.semesters.find((s) => s.semester_id === a.semester_id)?.end_date >= currentDate())) {
            assignment.roster_student_ids.push(value.user_id);
            assignment.student_group_ids[value.user_id] = value.group_id;
            for (const lesson of db.lessons.filter((l) => l.assignment_id === assignment.assignment_id && (!l.group_id || l.group_id===value.group_id))) db.attendance.push({ attendance_id:id("attendance","attendance_id"), student_id:value.user_id, lesson_id:lesson.lesson_id, status:"unmarked", reason:null });
          }
        }
        if (resource === "users" && row && hasRole(value,"student") && oldGroupId !== value.group_id) {
          for (const assignment of db.teaching_assignments.filter((item) => item.roster_group_ids.includes(value.group_id) && !db.disciplines.find((discipline) => discipline.discipline_id === item.discipline_id)?.is_elective && db.semesters.find((semester) => semester.semester_id === item.semester_id)?.end_date >= currentDate())) {
            if (!assignment.roster_student_ids.includes(value.user_id)) assignment.roster_student_ids.push(value.user_id);
            assignment.student_group_ids[value.user_id] = value.group_id;
            for (const lesson of db.lessons.filter((item) => item.assignment_id === assignment.assignment_id && (!item.group_id || item.group_id === value.group_id))) if (!db.attendance.some((entry) => entry.lesson_id === lesson.lesson_id && entry.student_id === value.user_id)) db.attendance.push({ attendance_id:id("attendance","attendance_id"), student_id:value.user_id, lesson_id:lesson.lesson_id, status:"unmarked", reason:null });
          }
        }
        if (newAssignment) { newAssignment.discipline_id = value.discipline_id; db.teaching_assignments.push(newAssignment); audit(actor, "assignment.create", `assignment:${newAssignment.assignment_id}`, `${value.name}; викладач ${newAssignment.teacher_id}; ${newAssignment.group_id ? "група " + newAssignment.group_id : "потік " + newAssignment.stream_id}`); }
        if (resource === "streams" && row) {
          for (const assignment of db.teaching_assignments.filter((a) => a.stream_id === value.stream_id && db.semesters.find((s) => s.semester_id === a.semester_id)?.end_date >= currentDate())) {
            for (const groupId of streamAdded) {
              if (!assignment.roster_group_ids.includes(groupId)) assignment.roster_group_ids.push(groupId);
              assignment.roster_group_names[groupId] = db.groups.find((g) => g.group_id === groupId)?.name;
            }
            for (const student of db.users.filter((u) => hasRole(u,"student") && streamAdded.includes(u.group_id) && u.status === "active")) {
              if (db.disciplines.find((d) => d.discipline_id === assignment.discipline_id)?.is_elective && !db.elective_enrollments.some((e) => e.student_id === student.user_id && e.discipline_id === assignment.discipline_id && e.semester_id === assignment.semester_id && e.status === "approved")) continue;
              if (!assignment.roster_student_ids.includes(student.user_id)) assignment.roster_student_ids.push(student.user_id);
              assignment.student_group_ids[student.user_id] = student.group_id;
              for (const lesson of db.lessons.filter((l) => l.assignment_id === assignment.assignment_id && (!l.group_id || l.group_id===student.group_id))) if (!db.attendance.some((a) => a.lesson_id === lesson.lesson_id && a.student_id === student.user_id)) db.attendance.push({ attendance_id: id("attendance", "attendance_id"), student_id: student.user_id, lesson_id: lesson.lesson_id, status: "unmarked", reason: null });
            }
          }
        }
        audit(actor, `${resource}.${row ? "update" : "create"}`, `${resource}:${value[key]}`, value.name || value.full_name || value.academic_year);
        persist();
        if (resource === "users") {
          const { password_hash, ...publicUser } = value;
          return send(row ? 200 : 201, publicUser);
        }
        return send(row ? 200 : 201, value);
      }
      fail(404, "Маршрут не знайдено.");
    } catch (e) {
      send(e.status || 500, {
        message: e.status
          ? e.message
          : "Не вдалося зберегти дані. Спробуйте ще раз.",
      });
    }
  };
}
