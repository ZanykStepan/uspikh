const pad = (value) => String(value).padStart(2, "0");

export function formatDate(value) {
  if (!value) return "—";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text.slice(8, 10)}-${text.slice(5, 7)}-${text.slice(0, 4)}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${formatDate(value)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function plural(count, one, few, many) {
  const n = Math.abs(Number(count)) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

const resources = { users: "обліковий запис", groups: "групу", streams: "потік", semesters: "семестр", disciplines: "дисципліну" };
const auditNames = {
  "grade.create": "Виставлено оцінку",
  "grade.update": "Виправлено оцінку",
  "lesson.create": "Створено заняття",
  "lesson.retroactive_exam": "Відновлено історичний екзамен",
  "attendance.update": "Змінено відвідуваність",
  "weights.save": "Збережено ваги",
  "discipline.details.update": "Оновлено опис дисципліни",
  "assignment.create": "Призначено викладача",
  "debt.update": "Змінено заборгованість",
  "elective.apply": "Подано заявку на вибіркову",
  "elective.cancel": "Скасовано заявку на вибіркову",
  "elective.approved": "Заявку на вибіркову підтверджено",
  "elective.rejected": "Заявку на вибіркову відхилено",
  "elective_limits.save": "Змінено ліміти вибіркових",
  "grade_correction.request": "Подано запит на виправлення оцінки",
  "grade_correction.approved": "Виправлення оцінки погоджено",
  "grade_correction.rejected": "Виправлення оцінки відхилено",
  "groups.promote": "Переведено групи на наступний курс",
  "groups.graduate": "Завершено навчання груп",
  "users.import": "Імпортовано студентів",
  "security.reserve_password": "Видано тимчасовий пароль",
  "security.unlock": "Знято блокування облікового запису",
};

export function auditLabel(action) {
  if (auditNames[action]) return auditNames[action];
  const [resource, verb] = String(action).split(".");
  if (resources[resource] && verb === "create") return `Створено ${resources[resource]}`;
  if (resources[resource] && verb === "update") return `Змінено ${resources[resource]}`;
  if (resources[resource] && verb === "delete") return `Видалено ${resources[resource]}`;
  return action;
}
