const json = (value) => (value === undefined ? null : JSON.stringify(value));

const arrayLink = (field, table, fk, column) => ({
  table,
  fk,
  columns: [column, "position"],
  read: (rows, row) => {
    row[field] = rows.map((item) => item[column]);
  },
  write: (row) => (row[field] || []).map((value, position) => ({ [column]: value, position })),
});

export const ENTITIES = [
  {
    name: "groups",
    pk: "group_id",
    columns: [
      "group_id",
      "name",
      "admission_year",
      "course",
      "program_years",
      "faculty",
      "specialty",
      "status",
      "graduated_at",
      "graduation_year",
    ],
  },
  {
    name: "users",
    pk: "user_id",
    columns: [
      "user_id",
      "full_name",
      "email",
      "role",
      "status",
      "student_status",
      "group_id",
      "faculty",
      "graduated_at",
      "repeat_of_group_id",
      "repeat_started_at",
    ],
    links: [arrayLink("roles", "user_roles", "user_id", "role"), arrayLink("curated_group_ids", "curator_groups", "user_id", "group_id")],
  },
  {
    name: "streams",
    pk: "stream_id",
    columns: ["stream_id", "name", "status", "graduated_at"],
    links: [arrayLink("group_ids", "stream_groups", "stream_id", "group_id")],
  },
  {
    name: "semesters",
    pk: "semester_id",
    columns: ["semester_id", "academic_year", "term_number", "start_date", "end_date", "is_current"],
  },
  {
    name: "disciplines",
    pk: "discipline_id",
    columns: [
      "discipline_id",
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
  },
  {
    name: "teaching_assignments",
    pk: "assignment_id",
    columns: [
      "assignment_id",
      "teacher_id",
      "discipline_id",
      "group_id",
      "stream_id",
      "semester_id",
      "course_at_assignment",
      "target_name_at_assignment",
    ],
    links: [
      {
        table: "assignment_groups",
        fk: "assignment_id",
        columns: ["group_id", "group_name", "position"],
        read: (rows, row) => {
          row.roster_group_ids = rows.map((item) => item.group_id);
          row.roster_group_names = Object.fromEntries(rows.map((item) => [item.group_id, item.group_name]));
        },
        write: (row) =>
          (row.roster_group_ids || []).map((groupId, position) => ({
            group_id: groupId,
            group_name: row.roster_group_names?.[groupId] ?? null,
            position,
          })),
      },
      {
        table: "assignment_roster",
        fk: "assignment_id",
        columns: ["student_id", "group_id", "position"],
        read: (rows, row) => {
          row.roster_student_ids = rows.map((item) => item.student_id);
          row.student_group_ids = Object.fromEntries(rows.map((item) => [item.student_id, item.group_id]));
        },
        write: (row) =>
          (row.roster_student_ids || []).map((studentId, position) => ({
            student_id: studentId,
            group_id: row.student_group_ids?.[studentId],
            position,
          })),
      },
    ],
  },
  {
    name: "weight_schemes",
    pk: "scheme_id",
    columns: ["scheme_id", "discipline_id", "course", "semester_id", "method", "updated_by", "updated_at"],
    links: [
      {
        table: "weight_scheme_items",
        fk: "scheme_id",
        columns: ["lesson_type", "weight"],
        read: (rows, row) => {
          row.weights = Object.fromEntries(rows.map((item) => [item.lesson_type, item.weight]));
        },
        write: (row) => Object.entries(row.weights || {}).map(([lesson_type, weight]) => ({ lesson_type, weight })),
      },
    ],
  },
  {
    name: "lessons",
    pk: "lesson_id",
    columns: [
      "lesson_id",
      "assignment_id",
      "group_id",
      "lesson_date",
      "lesson_type",
      "max_score",
      "topic",
      "approved_by",
      "retroactive_reason",
    ],
  },
  {
    name: "grades",
    pk: "grade_id",
    columns: ["grade_id", "student_id", "lesson_id", "value", "recorded_by", "approved_by", "given_at", "updated_at"],
  },
  {
    name: "grade_history",
    pk: "history_id",
    columns: ["history_id", "grade_id", "old_value", "new_value", "changed_by", "requested_by", "changed_at", "reason"],
  },
  {
    name: "grade_correction_requests",
    pk: "request_id",
    columns: [
      "request_id",
      "lesson_id",
      "student_id",
      "proposed_value",
      "previous_value",
      "reason",
      "requested_by",
      "requested_at",
      "status",
      "reviewed_by",
      "reviewed_at",
    ],
  },
  { name: "attendance", pk: "attendance_id", columns: ["attendance_id", "student_id", "lesson_id", "status", "reason"] },
  {
    name: "debts",
    pk: "debt_id",
    columns: ["debt_id", "student_id", "discipline_id", "semester_id", "reason", "deadline", "status", "source", "created_at", "closed_at"],
  },
  {
    name: "elective_enrollments",
    pk: "enrollment_id",
    columns: ["enrollment_id", "student_id", "discipline_id", "semester_id", "status", "enrolled_at"],
  },
  {
    name: "elective_limits",
    pk: "limit_id",
    columns: ["limit_id", "group_id", "catalog1_credits", "catalog2_credits", "max_disciplines", "updated_by", "updated_at"],
  },
  { name: "notifications", pk: "notification_id", columns: ["notification_id", "user_id", "message", "is_read", "created_at"] },
  { name: "audit_logs", pk: "audit_id", columns: ["audit_id", "actor_id", "action", "target", "detail", "at", "faculty"] },
  {
    name: "group_promotions",
    pk: "promotion_id",
    columns: ["promotion_id", "actor_id", "at", "group_ids", "academic_year", "rows"],
    jsonColumns: ["group_ids", "rows"],
  },
  {
    name: "graduations",
    pk: "graduation_id",
    columns: ["graduation_id", "actor_id", "at", "academic_year", "graduation_year", "course", "kind", "group_ids", "rows", "streams"],
    jsonColumns: ["group_ids", "rows", "streams"],
  },
];

export const valueFor = (entity, column, row) => {
  const value = row[column];
  if (value === undefined) return null;
  return entity.jsonColumns?.includes(column) ? json(value) : value;
};
