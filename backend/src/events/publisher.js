export const PHASE = Object.freeze({ TRANSACTION: "transaction", AFTER_COMMIT: "afterCommit" });

// Видавець подій (Subject). Спостерігачі транзакційної фази виконуються одразу й записують зміни
// в тій самій транзакції; спостерігачі фази afterCommit отримують подію лише після успішної фіксації.
export class DomainEventPublisher {
  #observers = [];
  #deferred = [];

  subscribe(observer, { phase = PHASE.TRANSACTION } = {}) {
    if (!this.#observers.some((item) => item.observer === observer)) this.#observers.push({ observer, phase });
    return () => this.unsubscribe(observer);
  }

  unsubscribe(observer) {
    this.#observers = this.#observers.filter((item) => item.observer !== observer);
  }

  publish(input) {
    const event = { at: new Date().toISOString(), ...input };
    for (const { observer, phase } of [...this.#observers]) {
      if (!observer.handles(event.type)) continue;
      if (phase === PHASE.TRANSACTION) observer.handle(event, this);
      else this.#deferred.push({ observer, event });
    }
  }

  async dispatchAfterCommit(log = console) {
    const queue = this.#deferred;
    this.#deferred = [];
    for (const { observer, event } of queue) {
      try {
        await observer.handle(event, this);
      } catch (error) {
        log.warn?.(`Спостерігач ${observer.constructor.name} не обробив подію ${event.type}: ${error.message}`);
      }
    }
  }

  discard() {
    this.#deferred = [];
  }
}

export class Observer {
  get eventTypes() {
    return [];
  }

  handles(type) {
    return this.eventTypes.includes(type);
  }

  handle() {
    throw new Error(`${this.constructor.name} не реалізує handle()`);
  }
}
