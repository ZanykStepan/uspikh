import { Observer } from "../publisher.js";
import { formatDate } from "../../domain/validators.js";

// Створює сповіщення студентам; після створення публікує подію notification.created.
export class NotificationObserver extends Observer {
  constructor(db, nextId) {
    super();
    this.db = db;
    this.nextId = nextId;
    this.messages = {
      "grade.saved": (event) => [[event.studentId, `Нову оцінку ${event.value} внесено до журналу.`]],
      "correction.reviewed": (event) =>
        event.request.status === "approved"
          ? [[event.request.student_id, `Деканат погодив виправлення оцінки: ${event.request.proposed_value}.`]]
          : [],
      "attendance.marked": (event) =>
        event.changed && event.record.status === "absent"
          ? [[event.record.student_id, `У журналі відмічено пропуск заняття (${event.record.reason}).`]]
          : [],
      "elective.reviewed": (event) =>
        event.statusChanged
          ? [
              [
                event.enrollment.student_id,
                `Заявку на вибіркову дисципліну «${event.discipline?.name || ""}» ${event.enrollment.status === "approved" ? "підтверджено" : "відхилено"} деканатом.`,
              ],
            ]
          : [],
      "debt.created": (event) => [
        [event.debt.student_id, `Виникла академічна заборгованість: ${event.reason}. Термін ліквідації встановить деканат.`],
      ],
      "debt.updated": (event) => [
        ...(event.closed ? [[event.debt.student_id, "Академічну заборгованість ліквідовано."]] : []),
        ...(event.deadlineSet ? [[event.debt.student_id, `Термін ліквідації заборгованості: ${formatDate(event.debt.deadline)}.`]] : []),
      ],
    };
  }

  get eventTypes() {
    return Object.keys(this.messages);
  }

  handle(event, publisher) {
    for (const [userId, message] of this.messages[event.type](event)) {
      const notification = {
        notification_id: this.nextId("notifications", "notification_id"),
        user_id: userId,
        message,
        is_read: false,
        created_at: event.at,
      };
      this.db.notifications.push(notification);
      publisher.publish({ type: "notification.created", at: event.at, notification });
    }
  }
}
