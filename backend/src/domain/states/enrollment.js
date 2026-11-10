import { HttpError } from "../../utils/httpError.js";

// Стан заявки студента на вибіркову дисципліну.
// pending — очікує рішення; approved / rejected — рішення деканату (його можна змінити).
export class EnrollmentState {
  get name() {
    throw new Error("Стан має визначати name");
  }

  get canReapply() {
    return false;
  }

  approve() {
    return new ApprovedEnrollmentState();
  }

  reject() {
    return new RejectedEnrollmentState();
  }

  cancel() {
    throw new HttpError(403, "Можна скасувати лише власну заявку, що очікує розгляду.");
  }
}

export class PendingEnrollmentState extends EnrollmentState {
  get name() {
    return "pending";
  }

  cancel() {
    return this;
  }
}

export class ApprovedEnrollmentState extends EnrollmentState {
  get name() {
    return "approved";
  }
}

export class RejectedEnrollmentState extends EnrollmentState {
  get name() {
    return "rejected";
  }

  get canReapply() {
    return true;
  }
}

const byName = { pending: PendingEnrollmentState, approved: ApprovedEnrollmentState, rejected: RejectedEnrollmentState };

export class EnrollmentLifecycle {
  constructor(row) {
    this.row = row;
    this.state = new (byName[row.status] || PendingEnrollmentState)();
  }

  get canReapply() {
    return this.state.canReapply;
  }

  // Повертає true, якщо статус справді змінився.
  review(decision) {
    if (decision !== "approved" && decision !== "rejected") throw new HttpError(422, "Некоректний статус.");
    const before = this.state.name;
    this.state = decision === "approved" ? this.state.approve() : this.state.reject();
    this.row.status = this.state.name;
    return before !== this.state.name;
  }

  cancel() {
    this.state.cancel();
  }
}
