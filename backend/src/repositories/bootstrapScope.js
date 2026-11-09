const NOTHING = { where: "false" };

const teacherAssignments = "SELECT assignment_id FROM teaching_assignments WHERE teacher_id = $1";
const teacherLessons = `SELECT lesson_id FROM lessons WHERE assignment_id IN (${teacherAssignments})`;

// Умови вибірки для GET /bootstrap: роль отримує лише ті записи, які потрапляють у відповідь.
export function bootstrapFilters({ userId, role }) {
  const own = { params: [userId] };
  const filters = {
    notifications: { ...own, where: "user_id = $1" },
    audit_logs:
      role === "admin"
        ? { limit: 1000 }
        : role === "dean"
          ? { ...own, where: "faculty = (SELECT faculty FROM users WHERE user_id = $1)", limit: 1000 }
          : NOTHING,
  };
  if (!["admin", "dean"].includes(role)) {
    filters.group_promotions = NOTHING;
    filters.graduations = NOTHING;
  }
  if (role === "student") {
    Object.assign(filters, {
      lessons: { ...own, where: "assignment_id IN (SELECT assignment_id FROM assignment_roster WHERE student_id = $1)" },
      grades: { ...own, where: "student_id = $1" },
      attendance: { ...own, where: "student_id = $1" },
      debts: { ...own, where: "student_id = $1" },
      grade_history: { ...own, where: "grade_id IN (SELECT grade_id FROM grades WHERE student_id = $1)" },
      grade_correction_requests: NOTHING,
      users: {
        ...own,
        where: "user_id = $1 OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = users.user_id AND r.role = 'teacher')",
      },
    });
  } else if (role === "teacher") {
    Object.assign(filters, {
      lessons: { ...own, where: `assignment_id IN (${teacherAssignments})` },
      grades: { ...own, where: `lesson_id IN (${teacherLessons})` },
      attendance: { ...own, where: `lesson_id IN (${teacherLessons})` },
      grade_history: { ...own, where: `grade_id IN (SELECT grade_id FROM grades WHERE lesson_id IN (${teacherLessons}))` },
      grade_correction_requests: { ...own, where: "requested_by = $1" },
      debts: NOTHING,
      elective_enrollments: NOTHING,
    });
  } else if (role === "curator") {
    filters.elective_enrollments = NOTHING;
  }
  return filters;
}
