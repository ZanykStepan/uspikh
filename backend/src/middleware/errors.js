export function notFound(_req, _res, next) {
  next(Object.assign(new Error("Маршрут не знайдено."), { status: 404 }));
}

const PG_ERRORS = {
  23505: [409, "Запис із такими даними вже існує."],
  23503: [409, "Запис пов’язаний з іншими даними."],
  23514: [422, "Дані не відповідають обмеженням бази даних."],
  23502: [422, "Не вказано обов’язкове поле."],
  "22P02": [400, "Некоректний формат даних."],
};

export function errorHandler(error, req, res, _next) {
  let status = error.status || error.statusCode;
  let message = error.message;
  if (error.type === "entity.parse.failed") [status, message] = [400, "Некоректний JSON."];
  else if (error.type === "entity.too.large") [status, message] = [413, "Завеликий запит."];
  else if (PG_ERRORS[error.code]) [status, message] = PG_ERRORS[error.code];
  else if (!status || status >= 500) {
    if (!req.app.locals.deps?.quiet) console.error(error);
    [status, message] = [500, "Внутрішня помилка сервера. Спробуйте ще раз."];
  }
  res.status(status).set("Cache-Control", "no-store").json({ status, message });
}
