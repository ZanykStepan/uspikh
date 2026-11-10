import { HttpError } from "../../utils/httpError.js";

// Стан академічної заборгованості: open ⇄ closed.
export class DebtState {
  get name() {
    throw new Error("Стан має визначати name");
  }

  close() {
    throw new HttpError(422, "Деканат може закрити лише відкритий борг.");
  }

  reopen() {
    return this;
  }
}

export class OpenDebtState extends DebtState {
  get name() {
    return "open";
  }

  close() {
    return new ClosedDebtState();
  }
}

export class ClosedDebtState extends DebtState {
  get name() {
    return "closed";
  }

  reopen() {
    return new OpenDebtState();
  }
}

export class DebtLifecycle {
  constructor(row) {
    this.row = row;
    this.state = row.status === "closed" ? new ClosedDebtState() : new OpenDebtState();
  }

  assertCanClose() {
    this.state.close();
  }

  close(at = new Date().toISOString()) {
    this.state = this.state.close();
    this.row.status = this.state.name;
    this.row.closed_at = at;
  }

  // Автоматичне повернення боргу у стан «відкритий», якщо умови знову виникли.
  reopen() {
    const wasClosed = this.state.name === "closed";
    this.state = this.state.reopen();
    this.row.status = this.state.name;
    if (wasClosed) this.row.deadline = null;
  }
}
