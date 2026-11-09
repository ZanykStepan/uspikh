import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  average,
  scoreBreakdown,
  validateGrade,
  semesterLessons,
  lessonTypes,
  normalizedGrade,
  convertSemesterScore,
} from "../src/domain/scoring.js";
import { seed } from "../src/seed/data.js";
import { freshClient, freshApi, fixture, closeTests, pool } from "./helpers.mjs";

after(closeTests);
test("Student sees only own grades and cannot change grades", async () => {
  const call = await freshClient();
  const r = await call("/bootstrap");
  assert.ok(r.data.grades.every((g) => g.student_id === 1));
  assert.equal((await call("/grades/1", "PATCH", { value: 100, reason: "Спроба зміни" })).status, 403);
});
test("Grade validation handles zero, empty, decimals and range", () => {
  assert.equal(validateGrade("0", "", false), "");
  for (const v of ["", -1, 101, 2.5, "abc"]) assert.notEqual(validateGrade(v, "", false), "");
  assert.notEqual(validateGrade(90, "", true), "");
  assert.equal(average([0, 100]), 50);
  assert.equal(average([]), null);
  for (const v of [" ", "1e2", "01.0", "101", "13"]) assert.notEqual(validateGrade(v, "", false, 12), "");
  assert.equal(validateGrade("12", "", false, 12), "");
});
test("Semester score uses unrounded normalized values and ignores another group's lessons", () => {
  const weights = Object.fromEntries(lessonTypes.map((type) => [type, 0]));
  weights["Лекція"] = 50;
  weights["Семінар"] = 50;
  const db = {
    groups: [{ group_id: 1, course: 4 }],
    streams: [],
    weight_schemes: [{ discipline_id: 1, semester_id: 1, course: 4, weights }],
    lessons: [
      { lesson_id: 1, assignment_id: 1, lesson_type: "Лекція", max_score: 3 },
      { lesson_id: 2, assignment_id: 1, lesson_type: "Семінар", max_score: 3 },
      { lesson_id: 3, assignment_id: 1, group_id: 2, lesson_type: "Лекція", max_score: 3 },
    ],
    grades: [
      { lesson_id: 1, student_id: 1, value: 1 },
      { lesson_id: 2, student_id: 1, value: 2 },
      { lesson_id: 3, student_id: 1, value: 3 },
    ],
  };
  const assignment = { assignment_id: 1, discipline_id: 1, semester_id: 1, group_id: 1, student_group_ids: { 1: 1 } };
  const result = scoreBreakdown(db, assignment, 1);
  assert.equal(result.semesterScore, 50);
  assert.equal(result.types.find((item) => item.type === "Лекція").count, 1);
  assert.equal(result.types.find((item) => item.type === "Семінар").count, 1);
});
test("Server rejects invalid grades independently of UI", async () => {
  const call = await freshClient();
  for (const value of [-1, 101, 2.5, "90", null])
    assert.equal((await call("/grades/1", "PATCH", { value, reason: "Перевірка" }, 7)).status, 422);
});
test("Grade correction records author, previous score and reason", async () => {
  const call = await freshClient();
  assert.equal((await call("/grades/1", "PATCH", { value: 96, reason: "Повторна перевірка" }, 7)).status, 200);
  const { data } = await call("/bootstrap", "GET", null, 7);
  assert.equal(data.grades.find((g) => g.grade_id === 1).value, 96);
  assert.deepEqual(
    data.grade_history.map((h) => [h.old_value, h.new_value, h.changed_by, h.reason]),
    [[90, 96, 7, "Повторна перевірка"]],
  );
});
test("Duplicate grade blocked and missing grade created", async () => {
  const call = await freshClient();
  assert.equal((await call("/grades", "POST", { student_id: 1, lesson_id: 1, value: 50 }, 7)).status, 409);
  assert.equal((await call("/grades", "POST", { student_id: 3, lesson_id: 12, value: 82 }, 7)).status, 201);
});
test("Elective CRUD with duplicate protection", async () => {
  const call = await freshClient();
  const r = await call("/elective_enrollments", "POST", {
    discipline_id: 5,
    semester_id: 2,
  });
  assert.equal(r.status, 201);
  assert.equal(
    (
      await call("/elective_enrollments", "POST", {
        discipline_id: 5,
        semester_id: 2,
      })
    ).status,
    409,
  );
  assert.equal((await call("/elective_enrollments/" + r.data.enrollment_id, "DELETE")).status, 200);
  assert.equal((await call("/bootstrap")).data.elective_enrollments.length, 0);
});
test("Approved enrollment cannot be deleted by student", async () => {
  const call = await freshClient();
  const r = await call("/elective_enrollments", "POST", {
    discipline_id: 5,
    semester_id: 2,
  });
  await call("/elective_enrollments/" + r.data.enrollment_id, "PATCH", { status: "approved" }, 11);
  assert.equal((await call("/elective_enrollments/" + r.data.enrollment_id, "DELETE")).status, 403);
});
test("Wrong semester and non-elective subject rejected", async () => {
  const call = await freshClient();
  assert.equal(
    (
      await call("/elective_enrollments", "POST", {
        discipline_id: 5,
        semester_id: 1,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call("/elective_enrollments", "POST", {
        discipline_id: 1,
        semester_id: 1,
      })
    ).status,
    422,
  );
  assert.equal(semesterLessons(seed(), 2).length, 0);
});
test("Attendance status and reason are validated", async () => {
  const call = await freshClient();
  assert.equal((await call("/attendance/1", "PATCH", { status: "absent", reason: "поважна" }, 7)).status, 200);
  assert.equal((await call("/attendance/1", "PATCH", { status: "absent", reason: "wrong" }, 7)).status, 422);
  assert.equal((await call("/attendance/1", "PATCH", { status: "present" }, 1)).status, 403);
});
test("Debt appears after term end; dean sets deadline and closes it after approved retake", async () => {
  let date = "2026-12-30";
  const call = await freshClient({ today: () => date });
  assert.equal((await call("/bootstrap")).data.debts.length, 0);
  const weights = Object.fromEntries(lessonTypes.map((type) => [type, type === "Екзамен" ? 100 : 0]));
  assert.equal((await call("/weight_schemes", "POST", { discipline_id: 1, semester_id: 1, course: 4, weights }, 7)).status, 200);
  const exam = await call(
    "/lessons",
    "POST",
    { assignment_id: 1, lesson_date: "2026-12-30", lesson_type: "Екзамен", topic: "Підсумковий екзамен", max_score: 100 },
    7,
  );
  assert.equal(exam.status, 201);
  date = "2027-01-01";
  const student = (await call("/bootstrap")).data;
  const debt = student.debts.find((item) => item.discipline_id === 1);
  assert.equal(debt.status, "open");
  assert.equal(debt.deadline, null);
  assert.match(debt.reason, /екзамену/);
  assert.equal((await call(`/debts/${debt.debt_id}`, "PATCH", { deadline: "2027-02-01" }, 7)).status, 403);
  assert.equal((await call(`/debts/${debt.debt_id}`, "PATCH", { deadline: "2027-02-01" }, 11)).status, 200);
  assert.equal((await call(`/debts/${debt.debt_id}`, "PATCH", { status: "closed" }, 11)).status, 409);
  assert.equal((await call("/grades", "POST", { student_id: 1, lesson_id: exam.data.lesson_id, value: 100 }, 7)).status, 409);
  assert.equal((await call("/weight_schemes", "POST", { discipline_id: 1, semester_id: 1, course: 4, weights }, 7)).status, 409);
  const correction = await call(
    "/grade_corrections",
    "POST",
    { student_id: 1, lesson_id: exam.data.lesson_id, proposed_value: 100, reason: "Успішна перездача екзамену" },
    7,
  );
  assert.equal(correction.status, 201);
  assert.equal((await call(`/grade_corrections/${correction.data.request_id}`, "PATCH", { status: "approved" }, 11)).status, 200);
  assert.equal((await call(`/debts/${debt.debt_id}`, "PATCH", { status: "closed" }, 11)).status, 200);
  assert.equal((await call("/bootstrap")).data.debts.find((item) => item.debt_id === debt.debt_id).status, "closed");
});
test("Roles receive only their own functional data", async () => {
  const call = await freshClient();
  const teacher = (await call("/bootstrap", "GET", null, 7)).data;
  const curator = (await call("/bootstrap", "GET", null, 9)).data;
  const dean = (await call("/bootstrap", "GET", null, 11)).data;
  const admin = (await call("/bootstrap", "GET", null, 10)).data;
  assert.equal(teacher.elective_enrollments.length, 0);
  assert.equal(teacher.debts.length, 0);
  assert.ok(curator.grades.length > 0);
  assert.equal(curator.elective_enrollments.length, 0);
  assert.ok(dean.grades.length > 0);
  assert.ok(dean.attendance.length > 0);
  assert.ok(admin.grades.length > 0);
  assert.ok(!dean.users.some((u) => "password_hash" in u));
  assert.equal(admin.audit_logs.length, 0);
});
test("Teacher creates a lesson with empty grade slots and attendance records", async () => {
  const call = await freshClient();
  const body = { assignment_id: 1, lesson_date: "2026-10-29", lesson_type: "Практична робота", topic: "Новий практикум", max_score: 100 };
  assert.equal((await call("/lessons", "POST", body, 1)).status, 403);
  const created = await call("/lessons", "POST", body, 7);
  assert.equal(created.status, 201);
  const teacher = (await call("/bootstrap", "GET", null, 7)).data;
  assert.equal(teacher.attendance.filter((a) => a.lesson_id === created.data.lesson_id).length, 5);
  assert.equal(teacher.grades.filter((g) => g.lesson_id === created.data.lesson_id).length, 0);
  assert.equal(teacher.audit_logs.length, 0);
  assert.equal((await call("/grades", "POST", { lesson_id: created.data.lesson_id, student_id: 2, value: 91 }, 7)).status, 201);
  const updated = (await call("/bootstrap", "GET", null, 7)).data;
  assert.equal(updated.grades.find((g) => g.lesson_id === created.data.lesson_id).value, 91);
  assert.equal(updated.grades.filter((g) => g.lesson_id !== created.data.lesson_id).length, 35);
});
test("Only dean approves elective applications", async () => {
  const call = await freshClient();
  const enrollment = await call("/elective_enrollments", "POST", { discipline_id: 5, semester_id: 2 });
  assert.equal((await call("/elective_enrollments/" + enrollment.data.enrollment_id, "PATCH", { status: "approved" }, 9)).status, 403);
  assert.equal((await call("/elective_enrollments/" + enrollment.data.enrollment_id, "PATCH", { status: "approved" }, 11)).status, 200);
});
test("Admin can manage reference data and inspect audit without editing grades", async () => {
  const call = await freshClient();
  const created = await call(
    "/groups",
    "POST",
    {
      name: "ІПЗ-43",
      course: 4,
      admission_year: 2023,
      specialty: "Інженерія програмного забезпечення",
      faculty: "Факультет математики та інформатики",
      status: "active",
    },
    10,
  );
  assert.equal(created.status, 201);
  assert.equal((await call("/grades/1", "PATCH", { value: 99, reason: "Перевірка" }, 10)).status, 403);
  const admin = (await call("/bootstrap", "GET", null, 10)).data;
  assert.equal(admin.groups.length, 3);
  assert.equal(admin.audit_logs[0].action, "groups.create");
  assert.equal((await call("/groups", "POST", { name: "ІПЗ-44", course: 4, admission_year: 2023 }, 7)).status, 403);
});
test("Student has no group ranking, and curator can see two assigned groups", async () => {
  const call = await freshClient();
  const student = (await call("/bootstrap")).data;
  assert.equal(Object.hasOwn(student, "rankings"), false);
  const curator = (await call("/bootstrap", "GET", null, 9)).data;
  assert.deepEqual(curator.me.curated_group_ids, [1, 2]);
  assert.equal(curator.users.filter((u) => u.role === "student").length, 5);
  assert.equal((await call("/users/9", "PATCH", { curated_group_ids: [2] }, 10)).status, 200);
  const updated = (await call("/bootstrap", "GET", null, 9)).data;
  assert.deepEqual(updated.me.curated_group_ids, [2]);
  assert.ok(updated.users.filter((u) => u.role === "student").every((u) => u.group_id === 2));
});
test("Teacher weights are required for semester score, total 100, and missing types count zero", async () => {
  const call = await freshClient();
  let student = (await call("/bootstrap")).data;
  assert.equal(scoreBreakdown(student, student.teaching_assignments[0], 1).semesterScore, null);
  const weights = Object.fromEntries(lessonTypes.map((type) => [type, type === "Лабораторна робота" || type === "Екзамен" ? 50 : 0]));
  const body = { discipline_id: 1, semester_id: 1, course: 4, weights };
  assert.equal((await call("/weight_schemes", "POST", body, 1)).status, 403);
  assert.equal((await call("/weight_schemes", "POST", { ...body, weights: { ...weights, Екзамен: 49 } }, 7)).status, 422);
  assert.equal((await call("/weight_schemes", "POST", body, 7)).status, 200);
  student = (await call("/bootstrap")).data;
  const result = scoreBreakdown(student, student.teaching_assignments[0], 1);
  assert.equal(result.semesterScore, 46.3);
  assert.equal(result.types.find((item) => item.type === "Екзамен").contribution, 0);
  assert.equal(result.scheme.weights["Екзамен"], 50);
});
test("Assigned teacher edits discipline description and syllabus; server rejects unsafe links", async () => {
  const call = await freshClient();
  const path = "/disciplines/1/details";
  const details = { description: "  Моделювання та розробка системи.  ", syllabus_url: "https://pnu.edu.ua/syllabus.pdf" };
  assert.equal((await call(path, "PATCH", details, 1)).status, 403);
  assert.equal((await call(path, "PATCH", { ...details, syllabus_url: "javascript:alert(1)" }, 7)).status, 422);
  assert.equal((await call(path, "PATCH", { ...details, description: "x".repeat(2001) }, 7)).status, 422);
  const saved = await call(path, "PATCH", details, 7);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.description, "Моделювання та розробка системи.");
  const student = (await call("/bootstrap", "GET", undefined, 1)).data;
  assert.equal(student.disciplines.find((item) => item.discipline_id === 1).syllabus_url, details.syllabus_url);
});
test("A new discipline must have a teacher and group or stream; stream lessons include both groups", async () => {
  const call = await freshClient();
  const discipline = {
    name: "Системне проєктування",
    description: "Проєктування інформаційних систем",
    syllabus_url: "https://pnu.edu.ua/course.pdf",
    credits: 4,
    semester_number: 7,
    is_elective: false,
    status: "active",
  };
  assert.equal((await call("/disciplines", "POST", discipline, 10)).status, 422);
  const created = await call(
    "/disciplines",
    "POST",
    { ...discipline, assignment: { teacher_id: 7, semester_id: 1, target_type: "stream", stream_id: 1 } },
    10,
  );
  assert.equal(created.status, 201);
  assert.equal(created.data.description, discipline.description);
  assert.equal(created.data.syllabus_url, discipline.syllabus_url);
  const teacher = (await call("/bootstrap", "GET", null, 7)).data;
  const assignment = teacher.teaching_assignments.find((a) => a.discipline_id === created.data.discipline_id);
  assert.equal(assignment.stream_id, 1);
  assert.equal(teacher.users.filter((u) => u.role === "student").length, 5);
  const lesson = await call(
    "/lessons",
    "POST",
    { assignment_id: assignment.assignment_id, lesson_date: "2026-10-29", lesson_type: "Лабораторна робота", topic: "Спільне заняття" },
    7,
  );
  assert.equal(lesson.status, 201);
  const groupTwoStudent = (await call("/bootstrap", "GET", null, 4)).data;
  assert.ok(groupTwoStudent.lessons.some((l) => l.lesson_id === lesson.data.lesson_id));
  assert.ok(groupTwoStudent.attendance.some((a) => a.lesson_id === lesson.data.lesson_id && a.status === "unmarked"));
  assert.equal((await call("/grades", "POST", { student_id: 4, lesson_id: lesson.data.lesson_id, value: 89 }, 7)).status, 201);
});
test("An elective journal opens only after dean approval and backfills lesson slots", async () => {
  const call = await freshClient();
  const before = (await call("/bootstrap")).data;
  assert.ok(!before.teaching_assignments.some((a) => a.discipline_id === 5));
  assert.ok(before.elective_offerings.some((offering) => offering.discipline_id === 5 && offering.semester_id === 2));
  const teacherBefore = (await call("/bootstrap", "GET", null, 7)).data;
  const elective = teacherBefore.teaching_assignments.find((a) => a.discipline_id === 5);
  const lesson = await call(
    "/lessons",
    "POST",
    { assignment_id: elective.assignment_id, lesson_date: "2027-03-01", lesson_type: "Лекція", topic: "Вступ до курсу" },
    7,
  );
  assert.equal(lesson.status, 201);
  assert.equal((await call("/grades", "POST", { student_id: 1, lesson_id: lesson.data.lesson_id, value: 88 }, 7)).status, 422);
  const application = await call("/elective_enrollments", "POST", { discipline_id: 5, semester_id: 2 });
  assert.equal((await call("/elective_enrollments/" + application.data.enrollment_id, "PATCH", { status: "approved" }, 11)).status, 200);
  const after = (await call("/bootstrap")).data;
  assert.ok(after.teaching_assignments.some((a) => a.discipline_id === 5));
  assert.ok(after.attendance.some((a) => a.lesson_id === lesson.data.lesson_id && a.status === "unmarked"));
  assert.equal((await call("/grades", "POST", { student_id: 1, lesson_id: lesson.data.lesson_id, value: 88 }, 7)).status, 201);
});

test("New eighth-semester elective is offered to both stream groups before approval", async () => {
  const call = await freshClient();
  const created = await call(
    "/disciplines",
    "POST",
    {
      name: "Інженерія вимог",
      credits: 3,
      semester_number: 8,
      is_elective: true,
      catalog: 3,
      capacity: 20,
      enrollment_start: "2026-09-15",
      enrollment_deadline: "2027-01-15",
      status: "active",
      assignment: { teacher_id: 7, semester_id: 2, target_type: "stream", stream_id: 1 },
    },
    10,
  );
  assert.equal(created.status, 201);
  for (const studentId of [1, 4]) {
    const student = (await call("/bootstrap", "GET", null, studentId)).data;
    assert.ok(
      student.elective_offerings.some((offering) => offering.discipline_id === created.data.discipline_id && offering.semester_id === 2),
    );
    assert.ok(!student.teaching_assignments.some((assignment) => assignment.discipline_id === created.data.discipline_id));
  }
  const application = await call("/elective_enrollments", "POST", { discipline_id: created.data.discipline_id, semester_id: 2 }, 1);
  assert.equal(application.status, 201);
  assert.equal((await call("/elective_enrollments/" + application.data.enrollment_id, "PATCH", { status: "approved" }, 11)).status, 200);
  const approved = (await call("/bootstrap", "GET", null, 1)).data;
  assert.ok(approved.teaching_assignments.some((assignment) => assignment.discipline_id === created.data.discipline_id));
  const notApproved = (await call("/bootstrap", "GET", null, 4)).data;
  assert.ok(!notApproved.teaching_assignments.some((assignment) => assignment.discipline_id === created.data.discipline_id));
});

test("University email login requires a password and does not expose password hashes", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  const anonymous = api.client();
  assert.equal((await anonymous("/bootstrap")).status, 401);
  assert.equal((await anonymous("/auth/login", "POST", { email: "demo1@pnu.edu.ua", password: "wrong" })).status, 401);
  const login = await anonymous("/auth/login", "POST", { email: "DEMO1@PNU.EDU.UA", password: "Demo2026!" });
  assert.equal(login.status, 200);
  const authenticated = api.client(login.data.token);
  const bootstrap = await authenticated("/bootstrap");
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.data.me.user_id, 1);
  assert.ok(!("password_hash" in bootstrap.data.me));
  assert.ok(bootstrap.data.users.every((user) => !("password_hash" in user)));
  assert.equal((await authenticated("/auth/logout", "POST")).status, 200);
  assert.equal((await authenticated("/bootstrap")).status, 401);
  assert.equal((await anonymous("/auth/login", "POST", { email: "demo7@pnu.edu.ua", password: "Demo2026!" })).status, 200);
  assert.equal((await anonymous("/auth/login", "POST", { email: "demo1@pnu.edu.ua", password: "Demo2026!" })).status, 200);
});

test("Per-lesson scales normalize to 100 and reject scores over their maximum", async () => {
  const call = await freshClient();
  const first = await call(
    "/lessons",
    "POST",
    { assignment_id: 1, lesson_date: "2026-10-29", lesson_type: "Зошит 12", topic: "Перевірка зошита", max_score: 12 },
    7,
  );
  assert.equal(first.status, 201);
  assert.equal((await call("/grades", "POST", { student_id: 4, lesson_id: first.data.lesson_id, value: 13 }, 7)).status, 422);
  assert.equal((await call("/grades", "POST", { student_id: 4, lesson_id: first.data.lesson_id, value: 12 }, 7)).status, 201);
  const second = await call(
    "/lessons",
    "POST",
    { assignment_id: 1, lesson_date: "2026-10-30", lesson_type: "Зошит 12", topic: "Додаткова перевірка", max_score: 5 },
    7,
  );
  assert.equal(second.status, 201);
  assert.equal((await call("/grades", "POST", { student_id: 4, lesson_id: second.data.lesson_id, value: 5 }, 7)).status, 201);
  assert.equal(
    (
      await call(
        "/lessons",
        "POST",
        { assignment_id: 1, lesson_date: "2026-10-31", lesson_type: "Зошит 12", topic: "Ще не перевірено", max_score: 12 },
        7,
      )
    ).status,
    201,
  );
  const weights = Object.fromEntries(lessonTypes.map((type) => [type, type === "Зошит 12" ? 100 : 0]));
  assert.equal((await call("/weight_schemes", "POST", { discipline_id: 1, semester_id: 1, course: 4, weights }, 7)).status, 200);
  const student = (await call("/bootstrap", "GET", null, 4)).data;
  assert.equal(
    normalizedGrade(
      student.grades.find((grade) => grade.lesson_id === first.data.lesson_id),
      first.data,
    ),
    100,
  );
  assert.equal(scoreBreakdown(student, student.teaching_assignments[0], 4).semesterScore, 100);
  assert.deepEqual(convertSemesterScore(100), { five: 5, twelve: 12, ects: "A" });
});

test("Stream journal includes two groups and keeps historic roster after course promotion", async () => {
  const call = await freshClient();
  await pool.query("UPDATE groups SET program_years = 6");
  const teacher = (await call("/bootstrap", "GET", null, 7)).data;
  const assignment = teacher.teaching_assignments.find((item) => item.assignment_id === 1);
  assert.deepEqual(assignment.roster_group_ids, [1, 2]);
  assert.deepEqual(assignment.roster_student_ids, [1, 2, 3, 4, 5]);
  assert.ok(teacher.assignment_student_ids[1].includes(4));
  const previewOne = await call("/progression/preview", "POST", { group_ids: [1] }, 10);
  assert.equal(previewOne.status, 422);
  const preview = await call("/progression/preview", "POST", { group_ids: [1, 2] }, 10);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.next_academic_year, "2027/2028");
  assert.equal((await call("/progression/apply", "POST", { group_ids: [1, 2], preview_key: "wrong" }, 10)).status, 409);
  assert.equal((await call("/progression/apply", "POST", { group_ids: [1, 2], preview_key: preview.data.key }, 10)).status, 200);
  const admin = (await call("/bootstrap", "GET", null, 10)).data;
  assert.deepEqual(
    admin.groups.map((group) => group.course),
    [5, 5],
  );
  assert.deepEqual(
    admin.groups.map((group) => group.name),
    ["ІПЗ-51", "ІПЗ-52"],
  );
  assert.ok(admin.semesters.some((semester) => semester.academic_year === "2027/2028" && semester.term_number === 2));
  assert.equal(admin.teaching_assignments.find((item) => item.assignment_id === 1).course_at_assignment, 4);
  assert.equal(admin.teaching_assignments.find((item) => item.assignment_id === 1).roster_group_names[1], "ІПЗ-41");
  const student = (await call("/bootstrap", "GET", null, 4)).data;
  assert.ok(student.lessons.some((lesson) => lesson.assignment_id === 1));
  assert.equal((await call("/groups/1", "PATCH", { course: 6 }, 10)).status, 409);
});

test("Course limit and faculty list are validated", async () => {
  const call = await freshClient();
  const group = {
    name: "ІПЗ-61",
    course: 6,
    program_years: 6,
    admission_year: 2021,
    specialty: "Інженерія програмного забезпечення",
    faculty: "Факультет математики та інформатики",
    status: "active",
  };
  assert.equal((await call("/groups", "POST", { ...group, course: 7 }, 10)).status, 422);
  assert.equal((await call("/groups", "POST", { ...group, faculty: "ФМІ" }, 10)).status, 422);
  assert.equal((await call("/groups", "POST", group, 10)).status, 201);
  const preview = await call("/progression/preview", "POST", { group_ids: [3] }, 10);
  assert.equal(preview.status, 422);
});

test("A multi-role account switches its active role without gaining new permissions", async () => {
  const api = await freshApi({ allowDemoHeader: false });
  const anonymous = api.client();
  const login = await anonymous("/auth/login", "POST", { email: "demo7@pnu.edu.ua", password: "Demo2026!" });
  assert.equal(login.status, 200);
  assert.deepEqual(login.data.user.roles, ["teacher", "curator"]);
  const call = api.client(login.data.token);
  assert.equal((await call("/bootstrap")).data.me.role, "teacher");
  assert.equal((await call("/auth/role", "POST", { role: "curator" })).status, 200);
  assert.equal((await call("/bootstrap")).data.me.role, "curator");
  assert.equal(
    (await call("/lessons", "POST", { assignment_id: 1, lesson_date: "2026-10-29", lesson_type: "Лекція", topic: "Недоступна дія" }))
      .status,
    403,
  );
  assert.equal((await call("/auth/role", "POST", { role: "admin" })).status, 403);
  assert.equal((await call("/bootstrap")).data.me.role, "curator");
  assert.equal((await call("/auth/role", "POST", { role: "teacher" })).status, 200);
  assert.equal((await call("/bootstrap")).data.me.role, "teacher");
});

test("Custom scale and group-specific lesson stay inside the chosen group of a stream", async () => {
  const call = await freshClient();
  const created = await call(
    "/lessons",
    "POST",
    { assignment_id: 1, group_id: 2, lesson_date: "2026-10-29", lesson_type: "Семінар", topic: "Груповий семінар", max_score: 17 },
    7,
  );
  assert.equal(created.status, 201);
  assert.equal(created.data.max_score, 17);
  const lessonId = created.data.lesson_id;
  const groupOne = (await call("/bootstrap", "GET", null, 1)).data;
  const groupTwo = (await call("/bootstrap", "GET", null, 4)).data;
  assert.ok(!groupOne.lessons.some((lesson) => lesson.lesson_id === lessonId));
  assert.ok(groupTwo.lessons.some((lesson) => lesson.lesson_id === lessonId));
  assert.ok(groupTwo.attendance.some((entry) => entry.lesson_id === lessonId));
  assert.equal((await call("/grades", "POST", { student_id: 1, lesson_id: lessonId, value: 17 }, 7)).status, 422);
  assert.equal((await call("/grades", "POST", { student_id: 4, lesson_id: lessonId, value: 18 }, 7)).status, 422);
  const grade = await call("/grades", "POST", { student_id: 4, lesson_id: lessonId, value: 17 }, 7);
  assert.equal(grade.status, 201);
  const saved = (await call("/bootstrap", "GET", null, 4)).data.grades.find((entry) => entry.lesson_id === lessonId);
  assert.equal(normalizedGrade(saved, created.data), 100);
});

test("Dean sees and manages only the own faculty, including course promotion", async () => {
  const call = await freshClient();
  await pool.query("UPDATE groups SET program_years = 6");
  const foreign = await call(
    "/groups",
    "POST",
    {
      name: "Е-41",
      course: 4,
      program_years: 6,
      admission_year: 2023,
      specialty: "Економіка",
      faculty: "Економічний факультет",
      status: "active",
    },
    10,
  );
  assert.equal(foreign.status, 201);
  const groupId = foreign.data.group_id;
  const dean = (await call("/bootstrap", "GET", null, 11)).data;
  assert.ok(!dean.groups.some((group) => group.group_id === groupId));
  assert.equal((await call(`/groups/${groupId}`, "PATCH", { name: "Е-42" }, 11)).status, 403);
  assert.equal((await call("/progression/preview", "POST", { group_ids: [groupId] }, 11)).status, 403);
  assert.equal(
    (
      await call(
        "/groups",
        "POST",
        {
          name: "ФМІ-43",
          course: 4,
          admission_year: 2023,
          specialty: "Інженерія програмного забезпечення",
          faculty: "Факультет математики та інформатики",
          status: "active",
        },
        11,
      )
    ).status,
    201,
  );
  const ownPreview = await call("/progression/preview", "POST", { group_ids: [1, 2] }, 11);
  assert.equal(ownPreview.status, 200);
  assert.equal((await call("/progression/apply", "POST", { group_ids: [1, 2], preview_key: ownPreview.data.key }, 11)).status, 200);
  const admin = (await call("/bootstrap", "GET", null, 10)).data;
  assert.equal(admin.groups.find((group) => group.group_id === groupId).course, 4);
  assert.equal(admin.groups.find((group) => group.group_id === 1).course, 5);
  assert.equal(admin.semesters.find((semester) => semester.is_current).academic_year, "2026/2027");
  assert.equal((await call("/progression/preview", "POST", { group_ids: [groupId] }, 10)).data.next_academic_year, "2027/2028");
});
test("Future elective is listed before registration and opens only on its start date", async () => {
  let date = "2026-09-01";
  const call = await freshClient({ today: () => date });
  const student = (await call("/bootstrap")).data;
  assert.ok(student.elective_offerings.some((entry) => entry.discipline_id === 5));
  assert.equal((await call("/elective_enrollments", "POST", { discipline_id: 5, semester_id: 2 })).status, 409);
  date = "2026-09-15";
  assert.equal((await call("/elective_enrollments", "POST", { discipline_id: 5, semester_id: 2 })).status, 201);
});
test("Dean can restore a missing historic exam with audit, then approve a retake", async () => {
  let date = "2026-12-30";
  const call = await freshClient({ today: () => date });
  const weights = Object.fromEntries(lessonTypes.map((type) => [type, type === "Екзамен" ? 100 : 0]));
  assert.equal((await call("/weight_schemes", "POST", { discipline_id: 1, semester_id: 1, course: 4, weights }, 7)).status, 200);
  date = "2027-01-01";
  const debt = (await call("/bootstrap")).data.debts.find((entry) => entry.student_id === 1 && entry.discipline_id === 1);
  assert.ok(debt);
  const body = {
    assignment_id: 1,
    group_id: 1,
    lesson_date: "2026-12-31",
    lesson_type: "Екзамен",
    topic: "Підсумковий екзамен",
    max_score: 100,
    reason: "Екзамен не створено вчасно",
  };
  assert.equal((await call("/lessons", "POST", body, 7)).status, 409);
  assert.equal((await call("/lessons", "POST", { ...body, reason: "ні" }, 11)).status, 422);
  const restored = await call("/lessons", "POST", body, 11);
  assert.equal(restored.status, 201);
  assert.equal((await call("/lessons", "POST", body, 11)).status, 409);
  const correction = await call(
    "/grade_corrections",
    "POST",
    { student_id: 1, lesson_id: restored.data.lesson_id, proposed_value: 80, reason: "Успішна перездача" },
    7,
  );
  assert.equal(correction.status, 201);
  assert.equal((await call(`/grade_corrections/${correction.data.request_id}`, "PATCH", { status: "approved" }, 11)).status, 200);
  assert.equal((await call(`/debts/${debt.debt_id}`, "PATCH", { deadline: "2027-02-01" }, 11)).status, 200);
  assert.equal((await call(`/debts/${debt.debt_id}`, "PATCH", { status: "closed" }, 11)).status, 200);
  const admin = (await call("/bootstrap", "GET", null, 10)).data;
  assert.ok(admin.audit_logs.some((entry) => entry.action === "lesson.retroactive_exam"));
});

test("Fourth-year graduation archives a whole stream and keeps graduate records readable", async () => {
  const { call, read, cleanup } = await fixture(seed());
  try {
    assert.equal((await call("/graduations/preview", "POST", { group_ids: [1] }, 10)).status, 422);
    const preview = await call("/graduations/preview", "POST", { group_ids: [1, 2] }, 10);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.course, 4);
    assert.deepEqual(preview.data.blockers, []);
    assert.equal((await call("/graduations/apply", "POST", { group_ids: [1, 2], preview_key: preview.data.key }, 10)).status, 200);
    const saved = await read();
    assert.ok(
      saved.groups
        .filter((group) => [1, 2].includes(group.group_id))
        .every((group) => group.status === "graduated" && group.name.includes("вип. 2027")),
    );
    assert.equal(saved.streams[0].status, "graduated");
    assert.ok(saved.users.filter((user) => [1, 2, 3, 4, 5].includes(user.user_id)).every((user) => user.student_status === "graduated"));
    assert.equal(saved.graduations.length, 1);
    assert.ok(saved.grades.length > 0);
    assert.ok(saved.group_promotions.some((event) => event.rows.some((row) => row.new_status === "graduated")));
    const graduate = await call("/bootstrap", "GET", null, 1);
    assert.equal(graduate.status, 200);
    assert.ok(graduate.data.grades.length > 0);
    assert.equal((await call("/auth/login", "POST", { email: "demo2@pnu.edu.ua", password: "Demo2026!" })).status, 200);
    assert.equal((await call("/elective_enrollments", "POST", { discipline_id: 5, semester_id: 2 }, 1)).status, 403);
    assert.equal((await call("/graduations/preview", "POST", { group_ids: [1, 2] }, 10)).status, 422);
  } finally {
    await cleanup();
  }
});

test("Sixth-year graduation is allowed; unfinished term blocks confirmation", async () => {
  const data = seed();
  for (const group of data.groups) {
    group.course = 6;
    group.program_years = 6;
    group.admission_year = 2021;
  }
  const { call, cleanup } = await fixture(data, "2026-11-01");
  try {
    const preview = await call("/graduations/preview", "POST", { group_ids: [1, 2] }, 10);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.course, 6);
    assert.ok(preview.data.blockers.length > 0);
    assert.equal((await call("/graduations/apply", "POST", { group_ids: [1, 2], preview_key: preview.data.key }, 10)).status, 409);
  } finally {
    await cleanup();
  }
  const second = await fixture(data);
  try {
    const preview = await second.call("/graduations/preview", "POST", { group_ids: [1, 2] }, 10);
    assert.deepEqual(preview.data.blockers, []);
    assert.equal((await second.call("/graduations/apply", "POST", { group_ids: [1, 2], preview_key: preview.data.key }, 10)).status, 200);
    assert.ok((await second.read()).groups.every((group) => group.status === "graduated"));
  } finally {
    await second.cleanup();
  }
});

test("Indebted student repeats in a new active group while classmates graduate", async () => {
  const data = seed();
  data.debts.push({
    debt_id: 51,
    student_id: 1,
    discipline_id: 1,
    semester_id: 1,
    reason: "Борг",
    deadline: null,
    status: "open",
    source: "manual",
    created_at: "2027-01-01T00:00:00Z",
  });
  const { call, read, cleanup } = await fixture(data);
  try {
    const preview = await call("/graduations/preview", "POST", { group_ids: [1, 2] }, 10);
    assert.deepEqual(preview.data.blockers, []);
    assert.ok(preview.data.rows.find((row) => row.group_id === 1).held_ids.includes(1));
    assert.equal((await call("/graduations/apply", "POST", { group_ids: [1, 2], preview_key: preview.data.key }, 10)).status, 200);
    assert.equal((await read()).users.find((user) => user.user_id === 1).student_status, "repeat_pending");
    assert.equal((await read()).users.find((user) => user.user_id === 2).status, "graduated");
    const group = await call(
      "/groups",
      "POST",
      {
        name: "ІПЗ-41",
        course: 4,
        admission_year: 2024,
        faculty: "Факультет математики та інформатики",
        specialty: "Інженерія програмного забезпечення",
        status: "active",
      },
      10,
    );
    assert.equal(group.status, 201);
    assert.equal((await call("/users/1", "PATCH", { group_id: group.data.group_id }, 10)).status, 200);
    const saved = await read();
    assert.equal(saved.users.find((user) => user.user_id === 1).student_status, "active");
    assert.equal(saved.users.find((user) => user.user_id === 1).group_id, group.data.group_id);
    assert.ok(saved.teaching_assignments.find((assignment) => assignment.assignment_id === 1).roster_student_ids.includes(1));
    assert.ok(saved.grades.some((grade) => grade.student_id === 1));
  } finally {
    await cleanup();
  }
});

test("Dean cannot graduate a group outside their faculty", async () => {
  const data = seed();
  data.groups.push({
    group_id: 3,
    name: "ФТ-41",
    course: 4,
    admission_year: 2023,
    faculty: "Фізико-технічний факультет",
    specialty: "Фізика",
    status: "active",
  });
  const { call, cleanup } = await fixture(data);
  try {
    assert.equal((await call("/graduations/preview", "POST", { group_ids: [3] }, 11)).status, 403);
  } finally {
    await cleanup();
  }
});

test("Rejected elective can be requested again and the student is notified of every decision", async () => {
  const call = await freshClient();
  const first = await call("/elective_enrollments", "POST", { discipline_id: 5, semester_id: 2 });
  assert.equal(first.status, 201);
  assert.equal((await call("/elective_enrollments/" + first.data.enrollment_id, "PATCH", { status: "rejected" }, 11)).status, 200);
  const notices = (await call("/bootstrap")).data.notifications;
  assert.ok(notices.some((item) => item.message.includes("відхилено")));
  const again = await call("/elective_enrollments", "POST", { discipline_id: 5, semester_id: 2 });
  assert.equal(again.status, 201);
  assert.equal(again.data.status, "pending");
  assert.equal((await call("/bootstrap")).data.elective_enrollments.filter((item) => item.discipline_id === 5).length, 1);
  await call("/elective_enrollments/" + again.data.enrollment_id, "PATCH", { status: "approved" }, 11);
  assert.ok((await call("/bootstrap")).data.notifications.some((item) => item.message.includes("підтверджено")));
});
test("Impossible calendar dates are rejected for lessons and debt deadlines", async () => {
  const call = await freshClient();
  const base = { assignment_id: 2, lesson_type: "Лекція", topic: "Перевірка дати", max_score: 100 };
  assert.equal((await call("/lessons", "POST", { ...base, lesson_date: "2026-11-31" }, 7)).status, 422);
  assert.equal((await call("/lessons", "POST", { ...base, lesson_date: "2026-02-30" }, 7)).status, 422);
  assert.equal((await call("/lessons", "POST", { ...base, lesson_date: "2026-10-30" }, 7)).status, 201);
});
test("Student bootstrap is limited to the student's own disciplines and groups and reports the server date", async () => {
  const call = await freshClient({ today: () => "2026-11-03" });
  const data = (await call("/bootstrap")).data;
  assert.equal(data.today, "2026-11-03");
  const allowed = new Set([
    ...data.teaching_assignments.map((a) => a.discipline_id),
    ...data.elective_offerings.map((o) => o.discipline_id),
  ]);
  assert.ok(data.disciplines.length > 0 && data.disciplines.every((d) => allowed.has(d.discipline_id)));
  const ownGroup = data.groups.find((g) => g.group_id === data.me.group_id);
  assert.ok(ownGroup);
});
test("Pass threshold is 50 in the demonstration scale", () => {
  assert.deepEqual(convertSemesterScore(50), { five: 3, twelve: 6, ects: "E" });
  assert.equal(convertSemesterScore(49).five, 2);
  assert.equal(convertSemesterScore(49).ects, "FX");
});
test("Score breakdown reports how many grades were entered", async () => {
  const call = await freshClient();
  const data = (await call("/bootstrap")).data;
  const result = scoreBreakdown(data, data.teaching_assignments[0], 1);
  assert.equal(
    result.gradedCount,
    result.types.reduce((sum, row) => sum + row.count, 0),
  );
});

test("Elective catalogs: credit limits for catalogs 1 and 2, a total limit, and seat counts", async () => {
  const call = await freshClient();
  const boot = (await call("/bootstrap")).data;
  assert.deepEqual(boot.my_elective_limits, { catalog1_credits: 9, catalog2_credits: 12, max_disciplines: 10 });
  assert.equal(boot.disciplines.find((d) => d.discipline_id === 5).catalog, 1);
  assert.equal(boot.disciplines.find((d) => d.discipline_id === 6).catalog, 2);
  const limits = { group_id: 1, catalog1_credits: 2, catalog2_credits: 12, max_disciplines: 1 };
  assert.equal((await call("/elective_limits", "POST", limits, 1)).status, 403);
  assert.equal((await call("/elective_limits", "POST", { ...limits, max_disciplines: 2.5 }, 11)).status, 422);
  assert.equal((await call("/elective_limits", "POST", limits, 11)).status, 200);
  assert.equal((await call("/bootstrap")).data.my_elective_limits.catalog1_credits, 2);
  assert.equal((await call("/bootstrap", "GET", undefined, 11)).data.elective_limits.length, 1);
  const credits = boot.disciplines.find((d) => d.discipline_id === 5).credits;
  assert.ok(credits > 2);
  assert.equal((await call("/elective_enrollments", "POST", { discipline_id: 5, semester_id: 2 })).status, 409);
  const second = await call("/elective_enrollments", "POST", { discipline_id: 6, semester_id: 2 });
  assert.equal(second.status, 201);
  assert.equal((await call("/elective_enrollments", "POST", { discipline_id: 5, semester_id: 2 })).status, 409);
  assert.equal((await call("/bootstrap")).data.elective_usage.total, 1);
  await call("/elective_enrollments/" + second.data.enrollment_id, "PATCH", { status: "rejected" }, 11);
  assert.equal((await call("/bootstrap")).data.elective_usage.total, 0);
});
test("A new elective discipline requires a catalog from 1 to 3", async () => {
  const call = await freshClient();
  const base = {
    name: "Нова вибіркова",
    credits: 3,
    semester_number: 8,
    is_elective: true,
    capacity: 10,
    enrollment_start: "2026-11-01",
    enrollment_deadline: "2026-12-01",
    status: "active",
    assignment: { teacher_id: 7, semester_id: 2, target_type: "stream", stream_id: 1 },
  };
  assert.equal((await call("/disciplines", "POST", base, 10)).status, 422);
  assert.equal((await call("/disciplines", "POST", { ...base, catalog: 4 }, 10)).status, 422);
  assert.equal((await call("/disciplines", "POST", { ...base, catalog: 2 }, 10)).status, 201);
});

test("Two-year program ends with dismissal and a PZSO certificate, not with a diploma", async () => {
  const data = seed();
  for (const group of data.groups) {
    group.course = 2;
    group.admission_year = 2025;
    group.program_years = 2;
  }
  const { call, read, cleanup } = await fixture(data, "2027-07-02");
  try {
    const promotion = await call("/progression/preview", "POST", { group_ids: [1, 2] }, 10);
    assert.equal(promotion.status, 422);
    const preview = await call("/graduations/preview", "POST", { group_ids: [1, 2] }, 10);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.kind, "certificate");
    assert.equal((await call("/graduations/apply", "POST", { group_ids: [1, 2], preview_key: preview.data.key }, 10)).status, 200);
    const saved = await read();
    assert.ok(saved.users.filter((user) => [1, 2, 3, 4, 5].includes(user.user_id)).every((user) => user.student_status === "dismissed"));
    assert.equal(saved.graduations[0].kind, "certificate");
    assert.equal((await call("/bootstrap", "GET", null, 1)).status, 200);
    assert.equal((await call("/elective_enrollments", "POST", { discipline_id: 5, semester_id: 2 }, 1)).status, 403);
  } finally {
    await cleanup();
  }
});

test("Completion is allowed only after the last course of the group's program", async () => {
  const data = seed();
  for (const group of data.groups) {
    group.course = 3;
    group.admission_year = 2024;
  }
  data.groups[1].program_years = 3;
  const { call, cleanup } = await fixture(data, "2027-07-02");
  try {
    assert.equal((await call("/graduations/preview", "POST", { group_ids: [1] }, 10)).status, 422);
    assert.equal((await call("/graduations/preview", "POST", { group_ids: [2] }, 10)).status, 422);
    assert.equal((await call("/progression/preview", "POST", { group_ids: [1, 2] }, 10)).status, 422);
    const threeYear = await call("/graduations/preview", "POST", { group_ids: [1, 2] }, 10);
    assert.equal(threeYear.status, 422);
  } finally {
    await cleanup();
  }
});

test("A five-year program is accepted and completes only after the fifth course", async () => {
  const call = await freshClient();
  const group = {
    name: "МЕД-51",
    course: 4,
    program_years: 5,
    admission_year: 2023,
    specialty: "Лабораторна діагностика",
    faculty: "Факультет природничих наук",
    status: "active",
  };
  const created = await call("/groups", "POST", group, 10);
  assert.equal(created.status, 201);
  assert.equal(created.data.program_years, 5);
  assert.equal((await call("/graduations/preview", "POST", { group_ids: [created.data.group_id] }, 10)).status, 422);
  assert.equal((await call("/groups", "POST", { ...group, name: "МЕД-52", program_years: 7 }, 10)).status, 422);
  assert.equal((await call("/groups", "POST", { ...group, name: "МЕД-53", course: 6, program_years: 5 }, 10)).status, 422);
});

test("A three-year program is completed with a diploma after the third course", async () => {
  const data = seed();
  for (const group of data.groups) {
    group.course = 3;
    group.admission_year = 2024;
    group.program_years = 3;
  }
  const { call, read, cleanup } = await fixture(data, "2027-07-02");
  try {
    const preview = await call("/graduations/preview", "POST", { group_ids: [1, 2] }, 10);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.kind, "diploma");
    assert.equal(preview.data.course, 3);
    assert.equal((await call("/graduations/apply", "POST", { group_ids: [1, 2], preview_key: preview.data.key }, 10)).status, 200);
    assert.ok((await read()).users.filter((user) => user.group_id).every((user) => user.student_status === "graduated"));
  } finally {
    await cleanup();
  }
});
