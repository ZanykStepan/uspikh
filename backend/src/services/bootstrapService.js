import { isArchivedStudent } from "../domain/validators.js";
import { semesterNumber } from "../domain/academic.js";

export function buildBootstrap(c) {
  const {
    db,
    actor,
    currentDate,
    hasRole,
    groupFaculty,
    userFaculty,
    eligibleForAssignment,
    assignmentGroupIds,
    electiveLimitsFor,
    electiveUsage,
    defaultElectiveLimits,
  } = c;
  const own = structuredClone(db);
  own.me = { ...actor, password_hash: undefined };
  own.today = currentDate();
  own.elective_defaults = defaultElectiveLimits;
  delete own.rankings;
  const ownAssignments = db.teaching_assignments.filter((a) => a.teacher_id === actor.user_id);
  const visibleGroupIds = actor.role === "curator" ? actor.curated_group_ids || [] : [actor.group_id];
  const groupStudents = db.users.filter((u) => hasRole(u, "student") && visibleGroupIds.includes(u.group_id)).map((u) => u.user_id);
  const lessonAllowed = (lessonId) => {
    const lesson = db.lessons.find((l) => l.lesson_id === lessonId);
    const assignment = db.teaching_assignments.find((a) => a.assignment_id === lesson?.assignment_id);
    if (actor.role === "teacher") return assignment?.teacher_id === actor.user_id;
    if (actor.role === "student")
      return (
        assignment &&
        eligibleForAssignment(assignment, actor.user_id) &&
        (!lesson.group_id || Number(assignment.student_group_ids?.[actor.user_id]) === lesson.group_id)
      );
    if (actor.role === "curator") return assignment && assignmentGroupIds(assignment).some((groupId) => visibleGroupIds.includes(groupId));
    return false;
  };
  if (actor.role === "student") {
    const rows = db.teaching_assignments.filter((a) => eligibleForAssignment(a, actor.user_id));
    const currentGroup = db.groups.find((group) => group.group_id === actor.group_id);
    own.elective_offerings = db.teaching_assignments
      .filter((assignment) => {
        const discipline = db.disciplines.find((item) => item.discipline_id === assignment.discipline_id);
        const semester = db.semesters.find((item) => item.semester_id === assignment.semester_id);
        return (
          !isArchivedStudent(actor.student_status) &&
          currentGroup?.status === "active" &&
          discipline?.is_elective &&
          discipline.status === "active" &&
          semester &&
          assignment.roster_group_ids.includes(currentGroup.group_id) &&
          assignment.course_at_assignment === currentGroup.course &&
          Number(semester.academic_year.slice(0, 4)) === currentGroup.admission_year + currentGroup.course - 1 &&
          discipline.semester_number === semesterNumber(currentGroup.course, semester.term_number)
        );
      })
      .map((assignment) => ({
        discipline_id: assignment.discipline_id,
        semester_id: assignment.semester_id,
        taken: db.elective_enrollments.filter(
          (entry) =>
            entry.discipline_id === assignment.discipline_id && entry.semester_id === assignment.semester_id && entry.status !== "rejected",
        ).length,
      }));
    own.teaching_assignments = rows;
    own.lessons = db.lessons.filter((l) =>
      rows.some((a) => a.assignment_id === l.assignment_id && (!l.group_id || Number(a.student_group_ids?.[actor.user_id]) === l.group_id)),
    );
    own.grades = db.grades.filter((g) => g.student_id === actor.user_id && lessonAllowed(g.lesson_id));
    own.attendance = db.attendance.filter((a) => a.student_id === actor.user_id && lessonAllowed(a.lesson_id));
    own.debts = db.debts.filter((d) => d.student_id === actor.user_id);
    own.elective_enrollments = db.elective_enrollments.filter((e) => e.student_id === actor.user_id);
    own.users = db.users.filter((u) => u.user_id === actor.user_id || hasRole(u, "teacher"));
    own.weight_schemes = db.weight_schemes.filter((w) =>
      rows.some((a) => a.discipline_id === w.discipline_id && a.semester_id === w.semester_id && a.course_at_assignment === w.course),
    );
    const visibleDisciplineIds = new Set([
      ...rows.map((a) => a.discipline_id),
      ...own.elective_offerings.map((offering) => offering.discipline_id),
    ]);
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
    own.users = db.users.filter(
      (u) => u.user_id === actor.user_id || (hasRole(u, "student") && ownAssignments.some((a) => a.roster_student_ids.includes(u.user_id))),
    );
    own.weight_schemes = db.weight_schemes.filter((w) =>
      ownAssignments.some(
        (a) => a.discipline_id === w.discipline_id && a.semester_id === w.semester_id && a.course_at_assignment === w.course,
      ),
    );
    own.assignment_student_ids = Object.fromEntries(
      ownAssignments.map((assignment) => [
        assignment.assignment_id,
        assignment.roster_student_ids.filter((studentId) => eligibleForAssignment(assignment, studentId)),
      ]),
    );
  } else if (actor.role === "curator") {
    own.teaching_assignments = db.teaching_assignments.filter((a) =>
      assignmentGroupIds(a).some((groupId) => visibleGroupIds.includes(groupId)),
    );
    own.lessons = db.lessons.filter((l) => own.teaching_assignments.some((a) => a.assignment_id === l.assignment_id));
    own.grades = db.grades.filter((g) => groupStudents.includes(g.student_id) && lessonAllowed(g.lesson_id));
    own.attendance = db.attendance.filter((a) => groupStudents.includes(a.student_id) && lessonAllowed(a.lesson_id));
    own.debts = db.debts.filter((d) => groupStudents.includes(d.student_id));
    own.elective_enrollments = [];
    own.users = db.users.filter(
      (u) =>
        u.user_id === actor.user_id ||
        groupStudents.includes(u.user_id) ||
        (hasRole(u, "student") &&
          own.teaching_assignments.some(
            (a) => a.roster_student_ids.includes(u.user_id) && visibleGroupIds.includes(a.student_group_ids[u.user_id]),
          )),
    );
    own.weight_schemes = db.weight_schemes.filter((w) =>
      own.teaching_assignments.some(
        (a) => a.discipline_id === w.discipline_id && a.semester_id === w.semester_id && a.course_at_assignment === w.course,
      ),
    );
  } else if (actor.role === "dean") {
    const facultyGroupIds = db.groups.filter((g) => g.faculty === actor.faculty).map((g) => g.group_id);
    own.groups = db.groups.filter((g) => facultyGroupIds.includes(g.group_id));
    own.streams = db.streams.filter((s) => s.group_ids.every((groupId) => facultyGroupIds.includes(groupId)));
    own.teaching_assignments = db.teaching_assignments.filter((a) =>
      assignmentGroupIds(a).every((groupId) => facultyGroupIds.includes(groupId)),
    );
    const ownAssignmentIds = new Set(own.teaching_assignments.map((a) => a.assignment_id));
    own.lessons = db.lessons.filter((l) => ownAssignmentIds.has(l.assignment_id));
    const ownLessonIds = new Set(own.lessons.map((l) => l.lesson_id));
    own.grades = db.grades.filter((g) => ownLessonIds.has(g.lesson_id));
    own.attendance = db.attendance.filter((a) => ownLessonIds.has(a.lesson_id));
    own.debts = db.debts.filter((d) => facultyGroupIds.includes(db.users.find((u) => u.user_id === d.student_id)?.group_id));
    own.elective_enrollments = db.elective_enrollments.filter((e) =>
      facultyGroupIds.includes(db.users.find((u) => u.user_id === e.student_id)?.group_id),
    );
    own.disciplines = db.disciplines.filter((d) => own.teaching_assignments.some((a) => a.discipline_id === d.discipline_id));
    own.users = db.users.filter((u) => u.user_id === actor.user_id || userFaculty(u) === actor.faculty);
    own.weight_schemes = db.weight_schemes.filter((w) =>
      own.teaching_assignments.some(
        (a) => a.discipline_id === w.discipline_id && a.semester_id === w.semester_id && a.course_at_assignment === w.course,
      ),
    );
    own.group_promotions = (db.group_promotions || []).filter((promotion) =>
      promotion.group_ids.every((groupId) => facultyGroupIds.includes(groupId)),
    );
    own.graduations = db.graduations.filter((graduation) => graduation.rows.every((row) => facultyGroupIds.includes(row.group_id)));
  } else {
    own.elective_enrollments = [];
  }
  own.elective_limits =
    actor.role === "admin"
      ? db.elective_limits
      : actor.role === "dean"
        ? db.elective_limits.filter((item) => groupFaculty(item.group_id) === actor.faculty)
        : [];
  if (!["admin", "dean"].includes(actor.role)) own.graduations = [];
  if (!["admin", "dean"].includes(actor.role)) own.group_promotions = [];
  own.notifications = own.notifications.filter((x) => x.user_id === actor.user_id);
  own.grade_history = own.grade_history.filter((h) => own.grades.some((g) => g.grade_id === h.grade_id));
  own.grade_correction_requests = db.grade_correction_requests.filter(
    (request) =>
      actor.role === "admin" ||
      (actor.role === "dean" && userFaculty(db.users.find((user) => user.user_id === request.student_id)) === actor.faculty) ||
      (actor.role === "teacher" && request.requested_by === actor.user_id),
  );
  if (actor.role === "dean") own.audit_logs = db.audit_logs.filter((entry) => entry.faculty === actor.faculty);
  else if (actor.role !== "admin") own.audit_logs = [];
  own.users = own.users.map(({ password_hash, ...user }) => user);
  return { status: 200, data: own };
}
