export function isValidCalendarDate(value) {
  return (
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}

export function isCorporateEmail(email, domains) {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(email)) return false;
  return domains.includes(email.split("@")[1].toLowerCase());
}

export function isScoreInRange(value, maximum = 100) {
  return Number.isInteger(value) && Number.isInteger(maximum) && value >= 0 && value <= maximum;
}

export function isDateWithin(date, start, end) {
  return isValidCalendarDate(date) && date >= start && date <= end;
}

export const isArchivedStudent = (status) => status === "graduated" || status === "dismissed";

export const completionKind = (group) => (group.program_years === 2 ? "certificate" : "diploma");

export const completionLabel = (kind) =>
  kind === "certificate" ? "Відрахування за завершенням навчання (свідоцтво ПЗСО)" : "Випуск (диплом)";

export const formatDate = (value) =>
  isValidCalendarDate(value) ? `${value.slice(8, 10)}-${value.slice(5, 7)}-${value.slice(0, 4)}` : value;
