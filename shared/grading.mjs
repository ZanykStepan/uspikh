import { lessonTypes } from "./academic.mjs";

const round1 = (value) => Math.round(value * 10) / 10;

export const assignmentGroupIds = (db, assignment) => {
  if (!assignment) return [];
  return (
    assignment.roster_group_ids ||
    (assignment.stream_id
      ? db.streams.find((stream) => stream.stream_id === assignment.stream_id)?.group_ids || []
      : assignment.group_id
        ? [assignment.group_id]
        : [])
  );
};

export const weightScheme = (db, assignment) => {
  if (!assignment) return null;
  const groupId = assignmentGroupIds(db, assignment)[0];
  const course = assignment.course_at_assignment || db.groups.find((group) => group.group_id === groupId)?.course;
  return (
    db.weight_schemes?.find(
      (scheme) => scheme.discipline_id === assignment.discipline_id && scheme.course === course && scheme.semester_id === assignment.semester_id,
    ) || null
  );
};

// Рядок за типом занять: середнє нормалізованих оцінок та їх кількість (без ваги).
const typeRow = (type, values) => {
  const rawMean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return { type, rawMean, mean: values.length ? round1(rawMean) : null, count: values.length };
};

export class GradingStrategy {
  get method() {
    throw new Error("Стратегія оцінювання має визначати method");
  }

  calculate() {
    throw new Error(`${this.constructor.name} не реалізує calculate()`);
  }
}

// Звичайний варіант: середні за типами занять множаться на ваги, задані викладачем.
export class WeightedByTypeStrategy extends GradingStrategy {
  get method() {
    return "weighted";
  }

  calculate({ scheme, valuesByType }) {
    const types = lessonTypes.map((type) => {
      const row = typeRow(type, valuesByType[type] || []);
      const weight = scheme?.weights[type] ?? null;
      return {
        type,
        mean: row.mean,
        count: row.count,
        weight,
        contribution: weight === null ? null : Math.round((row.rawMean * weight) / 10) / 10,
        rawContribution: weight === null ? null : (row.rawMean * weight) / 100,
      };
    });
    const semesterScore = scheme ? Math.min(100, round1(types.reduce((sum, row) => sum + row.rawContribution, 0))) : null;
    return { types, semesterScore };
  }
}

// Простий середній бал усіх оцінених занять семестру; ваги не потрібні.
export class SimpleAverageStrategy extends GradingStrategy {
  get method() {
    return "average";
  }

  calculate({ scheme, valuesByType }) {
    const all = Object.values(valuesByType).flat();
    const types = lessonTypes.map((type) => {
      const row = typeRow(type, valuesByType[type] || []);
      return { type, mean: row.mean, count: row.count, weight: null, contribution: null, rawContribution: null };
    });
    const semesterScore = scheme ? (all.length ? Math.min(100, round1(all.reduce((sum, value) => sum + value, 0) / all.length)) : 0) : null;
    return { types, semesterScore };
  }
}

export const gradingStrategies = {
  weighted: new WeightedByTypeStrategy(),
  average: new SimpleAverageStrategy(),
};
export const gradingMethods = Object.keys(gradingStrategies);

export const strategyFor = (scheme) => gradingStrategies[scheme?.method] || gradingStrategies.weighted;

// Контекст: збирає оцінки студента й делегує розрахунок обраній стратегії.
export class GradeCalculator {
  constructor(strategy = gradingStrategies.weighted) {
    this.strategy = strategy;
  }

  breakdown(db, assignment, studentId, scheme = weightScheme(db, assignment)) {
    const studentGroupId = Number(assignment?.student_group_ids?.[studentId]);
    const lessons = db.lessons.filter(
      (lesson) => lesson.assignment_id === assignment?.assignment_id && (!lesson.group_id || lesson.group_id === studentGroupId),
    );
    const valuesByType = {};
    for (const lesson of lessons) {
      const grade = db.grades.find((item) => item.student_id === studentId && item.lesson_id === lesson.lesson_id);
      const maximum = lesson.max_score || 100;
      const valid = grade && Number.isInteger(grade.value) && grade.value >= 0 && grade.value <= maximum && maximum > 0;
      if (valid) (valuesByType[lesson.lesson_type] ||= []).push((grade.value / maximum) * 100);
    }
    const { types, semesterScore } = this.strategy.calculate({ scheme, valuesByType });
    return { scheme, types, gradedCount: types.reduce((sum, row) => sum + row.count, 0), semesterScore };
  }
}

export function scoreBreakdown(db, assignment, studentId) {
  const scheme = weightScheme(db, assignment);
  return new GradeCalculator(strategyFor(scheme)).breakdown(db, assignment, studentId, scheme);
}
