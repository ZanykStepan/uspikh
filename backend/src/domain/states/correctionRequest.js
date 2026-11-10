import { HttpError } from "../../utils/httpError.js";

const decisionError = () => new HttpError(422, "Можна затвердити або відхилити лише запит на розгляді.");

// Стан запиту на виправлення оцінки: pending → approved | rejected. Решта станів кінцеві.
export class RequestState {
  get name() {
    throw new Error("Стан має визначати name");
  }

  approve() {
    throw decisionError();
  }

  reject() {
    throw decisionError();
  }
}

export class PendingRequestState extends RequestState {
  get name() {
    return "pending";
  }

  approve() {
    return new ApprovedRequestState();
  }

  reject() {
    return new RejectedRequestState();
  }
}

export class ApprovedRequestState extends RequestState {
  get name() {
    return "approved";
  }
}

export class RejectedRequestState extends RequestState {
  get name() {
    return "rejected";
  }
}

const byName = { pending: PendingRequestState, approved: ApprovedRequestState, rejected: RejectedRequestState };

// Контекст: запис запиту в базі й поточний об'єкт стану.
export class CorrectionRequestLifecycle {
  constructor(row) {
    this.row = row;
    this.state = new (byName[row.status] || RequestState)();
  }

  review(decision) {
    if (decision !== "approved" && decision !== "rejected") throw decisionError();
    this.state = decision === "approved" ? this.state.approve() : this.state.reject();
    this.row.status = this.state.name;
    return this.row;
  }
}
