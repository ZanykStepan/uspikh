import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  GradeCalculator,
  GradingStrategy,
  WeightedByTypeStrategy,
  SimpleAverageStrategy,
  gradingStrategies,
  strategyFor,
  scoreBreakdown,
} from "../../shared/grading.mjs";
import { GradeScaleConverter, ScaleStrategy, FiveScale, TwelveScale, EctsScale, convertSemesterScore } from "../../shared/scales.mjs";
import { lessonTypes } from "../src/domain/scoring.js";
import { DomainEventPublisher, PHASE, Observer } from "../src/events/publisher.js";
import { NotificationObserver } from "../src/events/observers/notificationObserver.js";
import { AuditObserver } from "../src/events/observers/auditObserver.js";
import { CorrectionRequestLifecycle } from "../src/domain/states/correctionRequest.js";
import { EnrollmentLifecycle } from "../src/domain/states/enrollment.js";
import { DebtLifecycle } from "../src/domain/states/debt.js";
import { freshClient, pool, closeTests } from "./helpers.mjs";

after(closeTests);

const zeroWeights = () => Object.fromEntries(lessonTypes.map((type) => [type, 0]));
function sampleData(method) {
  const weights = { ...zeroWeights(), "Лабораторна робота": 25, Екзамен: 75 };
  return {
    groups: [{ group_id: 1, course: 4 }],
    streams: [],
    weight_schemes: [{ discipline_id: 1, semester_id: 1, course: 4, weights, ...(method ? { method } : {}) }],
    lessons: [
      { lesson_id: 1, assignment_id: 1, lesson_type: "Лабораторна робота", max_score: 100 },
      { lesson_id: 2, assignment_id: 1, lesson_type: "Лабораторна робота", max_score: 100 },
      { lesson_id: 3, assignment_id: 1, lesson_type: "Екзамен", max_score: 100 },
    ],
    grades: [
      { lesson_id: 1, student_id: 1, value: 100 },
      { lesson_id: 2, student_id: 1, value: 80 },
      { lesson_id: 3, student_id: 1, value: 40 },
    ],
  };
}
const assignment = { assignment_id: 1, discipline_id: 1, semester_id: 1, group_id: 1, student_group_ids: { 1: 1 } };

test("Strategy: стратегії за вагами й простого середнього дають різні результати для тих самих оцінок", () => {
  const db = sampleData();
  assert.equal(new GradeCalculator(new WeightedByTypeStrategy()).breakdown(db, assignment, 1).semesterScore, 52.5);
  assert.equal(new GradeCalculator(new SimpleAverageStrategy()).breakdown(db, assignment, 1).semesterScore, 73.3);
});

test("Strategy: метод береться зі схеми оцінювання; невідомий метод означає розрахунок за вагами", () => {
  assert.equal(scoreBreakdown(sampleData(), assignment, 1).semesterScore, 52.5);
  assert.equal(scoreBreakdown(sampleData("average"), assignment, 1).semesterScore, 73.3);
  assert.equal(strategyFor({ method: "щось-інше" }), gradingStrategies.weighted);
  assert.equal(strategyFor(null), gradingStrategies.weighted);
});

test("Strategy: нову стратегію можна додати без зміни GradeCalculator", () => {
  class BestGradeStrategy extends GradingStrategy {
    get method() {
      return "best";
    }

    calculate({ valuesByType }) {
      return { types: [], semesterScore: Math.max(...Object.values(valuesByType).flat()) };
    }
  }
  const result = new GradeCalculator(new BestGradeStrategy()).breakdown(sampleData(), assignment, 1);
  assert.equal(result.semesterScore, 100);
  assert.throws(() => new GradingStrategy().calculate(), /не реалізує/);
});

test("Strategy: без схеми оцінювання бал не обчислюється для будь-якої стратегії", () => {
  const db = { ...sampleData(), weight_schemes: [] };
  for (const strategy of Object.values(gradingStrategies))
    assert.equal(new GradeCalculator(strategy).breakdown(db, assignment, 1).semesterScore, null);
});

test("Strategy: шкали переведення — окремі стратегії, набір шкал можна змінювати", () => {
  assert.deepEqual(convertSemesterScore(75), { five: 4, twelve: 9, ects: "C" });
  assert.equal(new FiveScale().convert(49), 2);
  assert.equal(new TwelveScale().convert(50), 6);
  assert.equal(new EctsScale().convert(35), "FX");
  class TenScale extends ScaleStrategy {
    constructor() {
      super("ten");
    }

    convert(score) {
      return Math.round(score / 10);
    }
  }
  assert.deepEqual(new GradeScaleConverter([new FiveScale(), new TenScale()]).convert(88), { five: 4, ten: 9 });
  assert.equal(new GradeScaleConverter([]).convert(null), null);
});

class Recorder extends Observer {
  constructor(types) {
    super();
    this.types = types;
    this.received = [];
  }

  get eventTypes() {
    return this.types;
  }

  handle(event) {
    this.received.push(event.type);
  }
}

test("Observer: підписка, відписка й повторна підписка того самого спостерігача", () => {
  const publisher = new DomainEventPublisher();
  const observer = new Recorder(["grade.saved"]);
  const unsubscribe = publisher.subscribe(observer);
  publisher.subscribe(observer);
  publisher.publish({ type: "grade.saved" });
  publisher.publish({ type: "attendance.marked" });
  assert.deepEqual(observer.received, ["grade.saved"]);
  unsubscribe();
  publisher.publish({ type: "grade.saved" });
  assert.equal(observer.received.length, 1);
});

test("Observer: спостерігачі фази afterCommit отримують подію лише після dispatch, а відкат скасовує їх", async () => {
  const publisher = new DomainEventPublisher();
  const inTransaction = new Recorder(["a"]);
  const later = new Recorder(["a"]);
  publisher.subscribe(inTransaction);
  publisher.subscribe(later, { phase: PHASE.AFTER_COMMIT });
  publisher.publish({ type: "a" });
  assert.equal(inTransaction.received.length, 1);
  assert.equal(later.received.length, 0);
  publisher.discard();
  await publisher.dispatchAfterCommit();
  assert.equal(later.received.length, 0);
  publisher.publish({ type: "a" });
  await publisher.dispatchAfterCommit();
  assert.equal(later.received.length, 1);
});

test("Observer: помилка спостерігача після фіксації не зупиняє інших і журналюється", async () => {
  const publisher = new DomainEventPublisher();
  class Broken extends Recorder {
    handle() {
      throw new Error("збій");
    }
  }
  const good = new Recorder(["a"]);
  publisher.subscribe(new Broken(["a"]), { phase: PHASE.AFTER_COMMIT });
  publisher.subscribe(good, { phase: PHASE.AFTER_COMMIT });
  publisher.publish({ type: "a" });
  const warnings = [];
  await publisher.dispatchAfterCommit({ warn: (message) => warnings.push(message) });
  assert.equal(good.received.length, 1);
  assert.match(warnings[0], /збій/);
});

test("Observer: подія виставлення оцінки створює сповіщення й запис аудиту окремими спостерігачами", () => {
  const db = { notifications: [] };
  const audit = [];
  let counter = 0;
  const publisher = new DomainEventPublisher();
  publisher.subscribe(new AuditObserver((actor, action, target, detail) => audit.push({ actor: actor.user_id, action, target, detail })));
  publisher.subscribe(new NotificationObserver(db, () => (counter += 1)));
  const created = new Recorder(["notification.created"]);
  publisher.subscribe(created);
  publisher.publish({ type: "grade.saved", actor: { user_id: 7 }, gradeId: 5, studentId: 3, lessonId: 12, value: 85, previous: null });
  assert.deepEqual(
    db.notifications.map((item) => [item.user_id, item.message]),
    [[3, "Нову оцінку 85 внесено до журналу."]],
  );
  assert.deepEqual(audit, [{ actor: 7, action: "grade.create", target: "lesson:12;student:3", detail: "85 балів" }]);
  assert.deepEqual(created.received, ["notification.created"]);
});

test("State: запит на виправлення переходить із pending лише в approved або rejected, далі стан кінцевий", () => {
  const request = { status: "pending" };
  const lifecycle = new CorrectionRequestLifecycle(request);
  lifecycle.review("approved");
  assert.equal(request.status, "approved");
  for (const decision of ["approved", "rejected"]) assert.throws(() => lifecycle.review(decision), { status: 422 });
  assert.throws(() => new CorrectionRequestLifecycle({ status: "pending" }).review("pending"), { status: 422 });
  assert.throws(() => new CorrectionRequestLifecycle({ status: "rejected" }).review("approved"), { status: 422 });
});

test("State: заявка на вибіркову — рішення можна змінити, скасувати можна лише очікувану, повторно подати — лише відхилену", () => {
  const row = { status: "pending" };
  const lifecycle = new EnrollmentLifecycle(row);
  assert.doesNotThrow(() => lifecycle.cancel());
  assert.equal(lifecycle.canReapply, false);
  assert.equal(lifecycle.review("approved"), true);
  assert.equal(lifecycle.review("approved"), false);
  assert.throws(() => lifecycle.cancel(), { status: 403 });
  assert.equal(lifecycle.review("rejected"), true);
  assert.equal(lifecycle.canReapply, true);
  assert.throws(() => lifecycle.review("pending"), { status: 422 });
});

test("State: борг закривається лише відкритим і повертається у відкритий стан зі скиданням терміну", () => {
  const debt = { status: "open", deadline: "2027-03-01" };
  const lifecycle = new DebtLifecycle(debt);
  lifecycle.close("2027-03-02T00:00:00.000Z");
  assert.deepEqual([debt.status, debt.closed_at], ["closed", "2027-03-02T00:00:00.000Z"]);
  assert.throws(() => lifecycle.assertCanClose(), { status: 422 });
  assert.throws(() => lifecycle.close(), { status: 422 });
  lifecycle.reopen();
  assert.deepEqual([debt.status, debt.deadline], ["open", null]);
});

test("Strategy в API: викладач вибирає метод розрахунку, невідомий метод відхиляється", async () => {
  const call = await freshClient();
  const base = { discipline_id: 1, semester_id: 1, course: 4 };
  assert.equal((await call("/weight_schemes", "POST", { ...base, method: "magic", weights: {} }, 7)).status, 422);
  const saved = await call("/weight_schemes", "POST", { ...base, method: "average" }, 7);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.method, "average");
  assert.equal((await pool.query("SELECT method FROM weight_schemes")).rows[0].method, "average");
  const bootstrap = (await call("/bootstrap", "GET", null, 7)).data;
  assert.equal(bootstrap.weight_schemes[0].method, "average");
  const weighted = await call(
    "/weight_schemes",
    "POST",
    { ...base, weights: Object.fromEntries(lessonTypes.map((type) => [type, type === "Лекція" ? 100 : 0])) },
    7,
  );
  assert.equal(weighted.data.method, "weighted");
});
