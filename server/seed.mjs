import { passwordHash } from "./auth.mjs";

export function seed() {
  const users = [
    {
      user_id: 1,
      full_name: "Заник Степан Петрович",
      role: "student",
      group_id: 1,
    },
    { user_id: 2, full_name: "Демо студент 02", role: "student", group_id: 1 },
    { user_id: 3, full_name: "Демо студент 03", role: "student", group_id: 1 },
    { user_id: 4, full_name: "Демо студент 04", role: "student", group_id: 2 },
    { user_id: 5, full_name: "Демо студент 05", role: "student", group_id: 2 },
    { user_id: 7, full_name: "Викладач журналу", role: "teacher" },
    { user_id: 9, full_name: "Куратор груп", role: "curator", curated_group_ids: [1, 2] },
    { user_id: 10, full_name: "Адміністратор", role: "admin" },
    { user_id: 11, full_name: "Представник деканату", role: "dean" },
  ].map((u) => ({ ...u, email: `demo${u.user_id}@pnu.edu.ua`, password_hash: passwordHash(u.user_id), status: "active" }));
  const names = [
    "Професійна практика програмної інженерії",
    "Хмарні технології",
    "Безпека програм та даних",
    "Технології DevOps",
    "Проєктування інтерфейсів",
    "Аналіз даних",
  ];
  const disciplines = names.map((name, i) => ({
    discipline_id: i + 1,
    name,
    credits: i < 4 ? 4 : 3,
    semester_number: i < 4 ? 7 : 8,
    is_elective: i >= 4,
    capacity: i >= 4 ? 25 : null,
    enrollment_start: i >= 4 ? "2026-09-15" : null,
    enrollment_deadline: i >= 4 ? "2026-12-15" : null,
    status: "active",
  }));
  const teaching_assignments = disciplines
    .map((d) => ({
      assignment_id: d.discipline_id,
      teacher_id: 7,
      discipline_id: d.discipline_id,
      group_id: d.is_elective || d.discipline_id === 1 ? null : 1,
      stream_id: d.is_elective || d.discipline_id === 1 ? 1 : null,
      semester_id: d.is_elective ? 2 : 1,
      course_at_assignment: 4,
      roster_group_ids: d.is_elective || d.discipline_id === 1 ? [1, 2] : [1],
      roster_student_ids: d.is_elective ? [] : d.discipline_id === 1 ? [1, 2, 3, 4, 5] : [1, 2, 3],
      student_group_ids: d.is_elective ? {} : d.discipline_id === 1 ? { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2 } : { 1: 1, 2: 1, 3: 1 },
    }));
  const lessons = teaching_assignments.filter((a) => a.semester_id === 1).flatMap((a) =>
    [0, 1, 2].map((j) => ({
      lesson_id: (a.assignment_id - 1) * 3 + j + 1,
      assignment_id: a.assignment_id,
      lesson_date: ["2026-10-07", "2026-10-14", "2026-10-21"][j],
      lesson_type: j === 2 ? "Контрольна / розрахунково-графічна робота" : "Лабораторна робота",
      max_score: 100,
      topic: [
        "Аналіз і планування",
        "Практична реалізація",
        "Контрольний модуль",
      ][j],
    })),
  );
  const values = [90, 95, 88, 82, 87, 91, 78, 84, 86, 85, 92, 94];
  const grades = users
    .filter((u) => u.role === "student" && u.group_id === 1)
    .flatMap((u, i) =>
      lessons.map((l, j) => ({
        grade_id: i * 12 + j + 1,
        student_id: u.user_id,
        lesson_id: l.lesson_id,
        value: values[j] - i * 7,
        recorded_by: 7,
        given_at: l.lesson_date + "T12:00:00Z",
        updated_at: l.lesson_date + "T12:00:00Z",
      })),
    );
  const attendance = users
    .filter((u) => u.role === "student" && u.group_id === 1)
    .flatMap((u, i) =>
      lessons.map((l, j) => ({
        attendance_id: i * 12 + j + 1,
        student_id: u.user_id,
        lesson_id: l.lesson_id,
        status: j === 3 || j === 8 ? "absent" : "present",
        reason: j === 3 ? "поважна" : j === 8 ? "неповажна" : null,
      })),
    );
  for (const u of users.filter((user) => user.role === "student" && user.group_id === 2)) {
    for (const l of lessons.filter((lesson) => lesson.assignment_id === 1)) {
      attendance.push({ attendance_id: attendance.length + 1, student_id: u.user_id, lesson_id: l.lesson_id, status: "unmarked", reason: null });
    }
  }
  grades.pop(); // Один порожній слот для демонстрації створення оцінки.
  return {
    groups: [
      {
        group_id: 1,
        name: "ІПЗ-41",
        admission_year: 2023,
        course: 4,
        faculty: "Факультет математики та інформатики",
        specialty: "Інженерія програмного забезпечення",
        status: "active",
      },
      {
        group_id: 2,
        name: "ІПЗ-42",
        admission_year: 2023,
        course: 4,
        faculty: "Факультет математики та інформатики",
        specialty: "Інженерія програмного забезпечення",
        status: "active",
      },
    ],
    streams: [{ stream_id: 1, name: "Потік ІПЗ-4", group_ids: [1, 2], status: "active" }],
    semesters: [
      {
        semester_id: 1,
        academic_year: "2026/2027",
        term_number: 1,
        start_date: "2026-09-01",
        end_date: "2026-12-31",
        is_current: true,
      },
      {
        semester_id: 2,
        academic_year: "2026/2027",
        term_number: 2,
        start_date: "2027-02-01",
        end_date: "2027-06-30",
        is_current: false,
      },
    ],
    users,
    disciplines,
    teaching_assignments,
    lessons,
    grades,
    grade_history: [],
    audit_logs: [],
    attendance,
    debts: [],
    elective_enrollments: [],
    notifications: [
      {
        notification_id: 1,
        user_id: 1,
        message: "Відкрито вибір дисциплін на 2 півріччя.",
        is_read: false,
        created_at: "2026-10-28T07:00:00Z",
      },
    ],
    group_promotions: [],
    graduations: [],
    demo_stream_migrated: true,
    weight_schemes: [],
  };
}
