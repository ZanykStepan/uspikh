import { Observer } from "../publisher.js";
import { formatDate } from "../../domain/validators.js";

export class AuditObserver extends Observer {
  constructor(audit) {
    super();
    this.audit = audit;
    this.writers = {
      "grade.saved": ({ actor, previous, studentId, lessonId, gradeId, value, reason }) =>
        previous
          ? this.audit(actor, "grade.update", `grade:${gradeId}`, `${previous.value} → ${value}; причина: ${reason}`)
          : this.audit(actor, "grade.create", `lesson:${lessonId};student:${studentId}`, `${value} балів`),
      "correction.requested": ({ actor, request }) =>
        this.audit(
          actor,
          "grade_correction.request",
          `request:${request.request_id}`,
          `${request.previous_value ?? "—"} → ${request.proposed_value}; ${request.reason}`,
        ),
      "correction.reviewed": ({ actor, request }) =>
        this.audit(
          actor,
          `grade_correction.${request.status}`,
          `request:${request.request_id}`,
          `${request.previous_value ?? "—"} → ${request.proposed_value}; ${request.reason}`,
        ),
      "attendance.marked": ({ actor, record }) =>
        this.audit(
          actor,
          "attendance.update",
          `attendance:${record.attendance_id}`,
          `${record.status}${record.reason ? ": " + record.reason : ""}`,
        ),
      "elective.applied": ({ actor, enrollment, discipline }) =>
        this.audit(actor, "elective.apply", `enrollment:${enrollment.enrollment_id}`, discipline.name),
      "elective.cancelled": ({ actor, enrollmentId }) => this.audit(actor, "elective.cancel", `enrollment:${enrollmentId}`, ""),
      "elective.reviewed": ({ actor, enrollment }) =>
        this.audit(actor, `elective.${enrollment.status}`, `enrollment:${enrollment.enrollment_id}`, ""),
      "elective.limits.saved": ({ actor, group, limits }) =>
        this.audit(
          actor,
          "elective_limits.save",
          `group:${group.group_id}`,
          `1 каталог ${limits.catalog1_credits} кр.; 2 каталог ${limits.catalog2_credits} кр.; усього дисциплін ${limits.max_disciplines}`,
        ),
      "debt.updated": ({ actor, debt }) =>
        this.audit(
          actor,
          "debt.update",
          `debt:${debt.debt_id}`,
          `${debt.status}; термін ${debt.deadline ? formatDate(debt.deadline) : "не встановлено"}`,
        ),
    };
  }

  get eventTypes() {
    return Object.keys(this.writers);
  }

  handle(event) {
    this.writers[event.type](event);
  }
}
