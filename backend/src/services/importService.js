import { HttpError } from "../utils/httpError.js";
import { saveDirectoryRecord } from "./directoryService.js";

const MAX_ROWS = 500;

export function parseCsv(text) {
  const lines = String(text || "")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const rows = lines.map((line, index) => ({
    line: index + 1,
    cells: line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")),
  }));
  if (rows[0].cells.length > 1 && !rows[0].cells[1].includes("@")) rows.shift();
  return rows;
}

export function importStudents(c) {
  const { db, actor, body, fail } = c;
  if (!["admin", "dean"].includes(actor.role)) fail(403, "Імпорт студентів виконує адміністратор або деканат.");
  if (typeof body.csv !== "string" || !body.csv.trim()) fail(422, "Додайте вміст CSV: рядки «ПІБ; пошта; група».");
  const rows = parseCsv(body.csv);
  if (!rows.length) fail(422, "У файлі немає рядків для імпорту.");
  if (rows.length > MAX_ROWS) fail(422, `За один раз можна імпортувати не більше ${MAX_ROWS} рядків.`);

  const result = [];
  for (const { line, cells } of rows) {
    const [fullName = "", email = "", groupName = ""] = cells;
    const item = { line, full_name: fullName, email: email.toLowerCase(), group: groupName, status: "ok", message: "" };
    try {
      if (cells.length < 3) throw new HttpError(422, "Потрібні три значення: ПІБ, пошта, група.");
      const candidates = db.groups.filter(
        (group) =>
          group.status === "active" &&
          group.name.toLowerCase() === groupName.toLowerCase() &&
          (actor.role === "admin" || group.faculty === actor.faculty),
      );
      if (!candidates.length) throw new HttpError(422, `Активної групи «${groupName}» немає.`);
      if (candidates.length > 1) throw new HttpError(422, `Назва групи «${groupName}» неоднозначна: вона є на кількох факультетах.`);
      saveDirectoryRecord({
        ...c,
        req: { method: "POST" },
        resource: "users",
        body: { full_name: fullName, email, roles: ["student"], group_id: candidates[0].group_id, status: "active" },
      });
    } catch (error) {
      if (!error.status) throw error;
      item.status = "error";
      item.message = error.message;
    }
    result.push(item);
  }
  const errors = result.filter((item) => item.status === "error").length;
  const summary = { total: result.length, valid: result.length - errors, errors, rows: result };
  if (body.dry_run || errors) {
    const message = errors ? `Імпорт не виконано: у файлі ${errors} рядків із помилками.` : "Перевірку пройдено. Дані ще не збережено.";
    return {
      status: errors && !body.dry_run ? 422 : 200,
      data: { ...summary, message, dry_run: Boolean(body.dry_run), status: errors && !body.dry_run ? 422 : 200 },
      rollback: true,
    };
  }
  c.audit(actor, "users.import", "users", `Імпортовано студентів: ${result.length}`);
  return { status: 201, data: { ...summary, message: `Імпортовано студентів: ${result.length}.`, dry_run: false } };
}
