import { Observer } from "../publisher.js";

// Після фіксації транзакції передає нове сповіщення в Redis (дзвіночок у реальному часі).
export class RealtimeObserver extends Observer {
  constructor(bus) {
    super();
    this.bus = bus;
  }

  get eventTypes() {
    return ["notification.created"];
  }

  async handle({ notification }) {
    await this.bus.publish(notification.user_id, notification);
  }
}
