const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ "application/json": { schema } });
const body = (schema, example) => ({ required: true, content: { "application/json": { schema, ...(example ? { example } : {}) } } });
const idParam = (name = "id") => ({ name, in: "path", required: true, schema: { type: "integer", minimum: 1 } });

const errorResponses = {
  400: { description: "Некоректний запит (JSON, ідентифікатор)", content: json(ref("Error")) },
  401: { description: "Потрібна автентифікація", content: json(ref("Error")) },
  403: { description: "Доступ заборонено для ролі", content: json(ref("Error")) },
  404: { description: "Ресурс не знайдено", content: json(ref("Error")) },
  409: { description: "Конфлікт даних або стану", content: json(ref("Error")) },
  422: { description: "Дані не пройшли валідацію", content: json(ref("Error")) },
};
const pick = (...codes) => Object.fromEntries(codes.map((code) => [code, errorResponses[code]]));
const secured = [{ bearerAuth: [] }];

const op = ({
  tag,
  summary,
  description,
  params,
  requestBody,
  ok = 200,
  okSchema,
  errors = [401, 403, 404, 409, 422],
  security = secured,
}) => ({
  tags: [tag],
  summary,
  ...(description ? { description } : {}),
  ...(security.length ? { security } : {}),
  ...(params ? { parameters: params } : {}),
  ...(requestBody ? { requestBody } : {}),
  responses: {
    [ok]: { description: ok === 201 ? "Створено" : "Успішно", ...(okSchema ? { content: json(okSchema) } : {}) },
    ...pick(...errors),
  },
});

const generic = { type: "object", additionalProperties: true };
const directory = (path, tag, summary, example) => ({
  [`/${path}`]: {
    post: op({
      tag,
      summary: `Створити: ${summary}`,
      requestBody: body(generic, example),
      ok: 201,
      okSchema: generic,
      errors: [400, 401, 403, 409, 422],
    }),
  },
  [`/${path}/{id}`]: {
    patch: op({ tag, summary: `Змінити: ${summary}`, params: [idParam()], requestBody: body(generic, example), okSchema: generic }),
    delete: op({
      tag,
      summary: `Видалити: ${summary} (лише адміністратор, лише запис без пов’язаних даних)`,
      params: [idParam()],
      okSchema: { type: "object", properties: { message: { type: "string" } } },
    }),
  },
});

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Успіх — REST API",
    version: "1.0.0",
    description:
      'Серверна частина системи обліку успішності студентів (Express + PostgreSQL). Автентифікація: корпоративний Google-акаунт (@pnu.edu.ua, @cnu.edu.ua) або резервний вхід за паролем. Токен передається в заголовку `Authorization: Bearer <JWT>`. Усі помилки мають вигляд `{ "status": 404, "message": "…" }`.',
  },
  servers: [{ url: "/api", description: "Поточний сервер" }],
  tags: [
    { name: "Автентифікація" },
    { name: "Дані" },
    { name: "Журнал" },
    { name: "Вибіркові дисципліни" },
    { name: "Борги" },
    { name: "Навчальний процес" },
    { name: "Довідники" },
    { name: "Безпека" },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: {
        type: "object",
        required: ["status", "message"],
        properties: { status: { type: "integer", example: 404 }, message: { type: "string", example: "Студента не знайдено." } },
      },
      User: {
        type: "object",
        properties: {
          user_id: { type: "integer" },
          full_name: { type: "string" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["student", "teacher", "curator", "dean", "admin"] },
          roles: { type: "array", items: { type: "string" } },
          group_id: { type: "integer", nullable: true },
          faculty: { type: "string" },
          status: { type: "string", enum: ["active", "inactive", "graduated"] },
        },
      },
      Session: {
        type: "object",
        properties: { token: { type: "string", description: "JWT" }, user: ref("User"), must_change_password: { type: "boolean" } },
      },
      Grade: {
        type: "object",
        properties: {
          grade_id: { type: "integer" },
          student_id: { type: "integer" },
          lesson_id: { type: "integer" },
          value: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
      Lesson: {
        type: "object",
        properties: {
          lesson_id: { type: "integer" },
          assignment_id: { type: "integer" },
          group_id: { type: "integer", nullable: true },
          lesson_date: { type: "string", format: "date" },
          lesson_type: { type: "string" },
          max_score: { type: "integer" },
          topic: { type: "string" },
        },
      },
      Message: { type: "object", properties: { message: { type: "string" } } },
    },
  },
  paths: {
    "/health": {
      get: op({
        tag: "Автентифікація",
        summary: "Перевірка стану сервера",
        security: [],
        okSchema: { type: "object", properties: { status: { type: "string", example: "ok" } } },
        errors: [],
      }),
    },
    "/auth/options": {
      get: op({
        tag: "Автентифікація",
        summary: "Доступні способи входу",
        security: [],
        okSchema: {
          type: "object",
          properties: { google: { type: "boolean" }, reserve: { type: "boolean" }, domains: { type: "array", items: { type: "string" } } },
        },
        errors: [],
      }),
    },
    "/auth/google/start": {
      get: {
        tags: ["Автентифікація"],
        summary: "Початок входу через Google (редірект на accounts.google.com)",
        responses: {
          302: { description: "Перенаправлення до Google" },
          503: { description: "Google OIDC не налаштовано", content: json(ref("Error")) },
        },
      },
    },
    "/auth/google/callback": {
      get: {
        tags: ["Автентифікація"],
        summary: "Повернення з Google; перевіряє домен і наявність облікового запису",
        description: "Успіх: редірект на `FRONTEND_URL/#/auth/callback?token=…`; помилка: `…?error=domain|not_registered|state|google`.",
        responses: { 302: { description: "Перенаправлення в інтерфейс" } },
      },
    },
    "/auth/login": {
      post: op({
        tag: "Автентифікація",
        summary: "Резервний вхід: пошта + пароль",
        security: [],
        requestBody: body(
          { type: "object", required: ["email", "password"], properties: { email: { type: "string" }, password: { type: "string" } } },
          { email: "demo1@pnu.edu.ua", password: "Demo2026!" },
        ),
        okSchema: ref("Session"),
        errors: [400, 401, 403],
      }),
    },
    "/auth/logout": { post: op({ tag: "Автентифікація", summary: "Вихід (відкликає сесію)", okSchema: ref("Message"), errors: [401] }) },
    "/auth/role": {
      post: op({
        tag: "Автентифікація",
        summary: "Перемикання активної ролі",
        requestBody: body({ type: "object", required: ["role"], properties: { role: { type: "string" } } }, { role: "curator" }),
        errors: [401, 403],
      }),
    },
    "/auth/password": {
      post: op({
        tag: "Автентифікація",
        summary: "Встановити або змінити власний резервний пароль",
        description:
          "Якщо пароль уже є (зокрема тимчасовий від адміністратора), потрібен current_password. Після входу через Google пароль можна встановити вперше без поточного.",
        requestBody: body({
          type: "object",
          required: ["new_password"],
          properties: { current_password: { type: "string" }, new_password: { type: "string", minLength: 10 } },
        }),
        okSchema: ref("Message"),
        errors: [401, 403, 422],
      }),
    },
    "/auth/security": {
      get: op({
        tag: "Автентифікація",
        summary: "Стан резервного пароля поточного користувача",
        okSchema: {
          type: "object",
          properties: { has_password: { type: "boolean" }, must_change_password: { type: "boolean" }, method: { type: "string" } },
        },
        errors: [401],
      }),
    },
    "/bootstrap": {
      get: op({
        tag: "Дані",
        summary: "Дані для інтерфейсу, відфільтровані за роллю",
        description:
          "Повертає знімок довідників, призначень, занять, оцінок, відвідуваності, боргів, сповіщень тощо — лише те, що дозволено поточній ролі.",
        okSchema: generic,
        errors: [401],
      }),
    },
    "/disciplines/{id}/details": {
      patch: op({
        tag: "Навчальний процес",
        summary: "Опис і посилання на силабус (призначений викладач)",
        params: [idParam()],
        requestBody: body({
          type: "object",
          properties: { description: { type: "string", maxLength: 2000 }, syllabus_url: { type: "string", maxLength: 2048 } },
        }),
        okSchema: generic,
      }),
    },
    "/weight_schemes": {
      post: op({
        tag: "Журнал",
        summary: "Ваги типів занять (сума 100%)",
        requestBody: body({
          type: "object",
          required: ["discipline_id", "semester_id", "course", "weights"],
          properties: {
            discipline_id: { type: "integer" },
            semester_id: { type: "integer" },
            course: { type: "integer" },
            weights: { type: "object", additionalProperties: { type: "integer", minimum: 0, maximum: 100 } },
          },
        }),
        okSchema: generic,
      }),
    },
    "/lessons": {
      post: op({
        tag: "Журнал",
        summary: "Створити заняття",
        requestBody: body({
          type: "object",
          required: ["assignment_id", "lesson_date", "lesson_type", "topic"],
          properties: {
            assignment_id: { type: "integer" },
            group_id: { type: "integer", nullable: true },
            lesson_date: { type: "string", format: "date" },
            lesson_type: { type: "string" },
            max_score: { type: "integer", minimum: 1, maximum: 100 },
            topic: { type: "string", minLength: 3, maxLength: 160 },
          },
        }),
        ok: 201,
        okSchema: ref("Lesson"),
      }),
    },
    "/grades": {
      post: op({
        tag: "Журнал",
        summary: "Виставити оцінку",
        requestBody: body({
          type: "object",
          required: ["lesson_id", "student_id", "value"],
          properties: { lesson_id: { type: "integer" }, student_id: { type: "integer" }, value: { type: "integer", minimum: 0 } },
        }),
        ok: 201,
        okSchema: ref("Message"),
      }),
    },
    "/grades/{id}": {
      patch: op({
        tag: "Журнал",
        summary: "Виправити оцінку (потрібна причина 5–255 символів)",
        params: [idParam()],
        requestBody: body({
          type: "object",
          required: ["value", "reason"],
          properties: { value: { type: "integer" }, reason: { type: "string", minLength: 5, maxLength: 255 } },
        }),
        okSchema: ref("Message"),
      }),
    },
    "/grade_corrections": {
      post: op({
        tag: "Журнал",
        summary: "Запит на виправлення оцінки після завершення семестру",
        requestBody: body({
          type: "object",
          required: ["lesson_id", "student_id", "proposed_value", "reason"],
          properties: {
            lesson_id: { type: "integer" },
            student_id: { type: "integer" },
            proposed_value: { type: "integer" },
            reason: { type: "string" },
          },
        }),
        ok: 201,
        okSchema: generic,
      }),
    },
    "/grade_corrections/{id}": {
      patch: op({
        tag: "Журнал",
        summary: "Рішення деканату щодо запиту",
        params: [idParam()],
        requestBody: body({
          type: "object",
          required: ["status"],
          properties: { status: { type: "string", enum: ["approved", "rejected"] } },
        }),
        okSchema: generic,
      }),
    },
    "/attendance/{id}": {
      patch: op({
        tag: "Журнал",
        summary: "Відмітити відвідуваність",
        params: [idParam()],
        requestBody: body({
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["present", "absent"] },
            reason: { type: "string", enum: ["поважна", "неповажна"] },
          },
        }),
        okSchema: generic,
      }),
    },
    "/elective_enrollments": {
      post: op({
        tag: "Вибіркові дисципліни",
        summary: "Подати заявку на вибіркову дисципліну (перевіряються ліміти каталогів, місця, терміни)",
        requestBody: body({
          type: "object",
          required: ["discipline_id", "semester_id"],
          properties: { discipline_id: { type: "integer" }, semester_id: { type: "integer" } },
        }),
        ok: 201,
        okSchema: generic,
      }),
    },
    "/elective_enrollments/{id}": {
      patch: op({
        tag: "Вибіркові дисципліни",
        summary: "Затвердити або відхилити заявку (деканат)",
        params: [idParam()],
        requestBody: body({
          type: "object",
          required: ["status"],
          properties: { status: { type: "string", enum: ["approved", "rejected"] } },
        }),
        okSchema: generic,
      }),
      delete: op({
        tag: "Вибіркові дисципліни",
        summary: "Скасувати власну заявку, що очікує розгляду",
        params: [idParam()],
        okSchema: ref("Message"),
      }),
    },
    "/elective_limits": {
      post: op({
        tag: "Вибіркові дисципліни",
        summary: "Ліміти вибіркових для групи (деканат, адміністратор)",
        requestBody: body(
          {
            type: "object",
            required: ["group_id", "catalog1_credits", "catalog2_credits", "max_disciplines"],
            properties: {
              group_id: { type: "integer" },
              catalog1_credits: { type: "integer" },
              catalog2_credits: { type: "integer" },
              max_disciplines: { type: "integer" },
            },
          },
          { group_id: 1, catalog1_credits: 9, catalog2_credits: 12, max_disciplines: 10 },
        ),
        okSchema: generic,
      }),
    },
    "/debts/{id}": {
      patch: op({
        tag: "Борги",
        summary: "Термін ліквідації та закриття боргу (деканат)",
        params: [idParam()],
        requestBody: body({
          type: "object",
          properties: { deadline: { type: "string", format: "date" }, status: { type: "string", enum: ["closed"] } },
        }),
        okSchema: generic,
      }),
    },
    "/notifications/stream": {
      get: {
        tags: ["Дані"],
        summary: "Потік сповіщень у реальному часі (Server-Sent Events)",
        description: "Події `ready` і `notification`. Нові сповіщення надходять через Redis pub/sub.",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "text/event-stream" }, 401: { description: "Потрібна автентифікація" } },
      },
    },
    "/notifications/unread": {
      get: op({
        tag: "Дані",
        summary: "Кількість непрочитаних сповіщень (лічильник у Redis)",
        okSchema: { type: "object", properties: { unread: { type: "integer" }, source: { type: "string", enum: ["redis", "memory"] } } },
        errors: [401],
      }),
    },
    "/notifications/read-all": {
      post: op({
        tag: "Дані",
        summary: "Позначити всі свої сповіщення прочитаними",
        okSchema: { type: "object", properties: { updated: { type: "integer" } } },
        errors: [401],
      }),
    },
    "/notifications/{id}": {
      patch: op({
        tag: "Дані",
        summary: "Позначити сповіщення прочитаним",
        params: [idParam()],
        okSchema: generic,
        errors: [400, 401, 404],
      }),
    },
    "/progression/{action}": {
      post: op({
        tag: "Навчальний процес",
        summary: "Переведення груп на наступний курс: попередній перегляд або застосування",
        params: [{ name: "action", in: "path", required: true, schema: { type: "string", enum: ["preview", "apply"] } }],
        requestBody: body({
          type: "object",
          required: ["group_ids"],
          properties: {
            group_ids: { type: "array", items: { type: "integer" } },
            preview_key: { type: "string", description: "Ключ плану, отриманий у preview (для apply)" },
          },
        }),
        okSchema: generic,
      }),
    },
    "/graduations/{action}": {
      post: op({
        tag: "Навчальний процес",
        summary: "Випуск груп: попередній перегляд або застосування",
        params: [{ name: "action", in: "path", required: true, schema: { type: "string", enum: ["preview", "apply"] } }],
        requestBody: body({
          type: "object",
          required: ["group_ids"],
          properties: { group_ids: { type: "array", items: { type: "integer" } }, preview_key: { type: "string" } },
        }),
        okSchema: generic,
      }),
    },
    "/users/import": {
      post: op({
        tag: "Довідники",
        summary: "Імпорт студентів із CSV (ПІБ; пошта; група). dry_run — лише перевірка без збереження",
        requestBody: body(
          { type: "object", required: ["csv"], properties: { csv: { type: "string" }, dry_run: { type: "boolean" } } },
          { csv: "ПІБ; пошта; група\nПетренко Іван Олегович; ivan.petrenko@pnu.edu.ua; ІПЗ-41", dry_run: true },
        ),
        ok: 201,
        okSchema: generic,
        errors: [401, 403, 422],
      }),
    },
    ...directory("users", "Довідники", "користувача (обліковий запис створює адміністратор)", {
      full_name: "Прізвище Ім’я По батькові",
      email: "name@cnu.edu.ua",
      roles: ["teacher"],
      faculty: "Факультет математики та інформатики",
      status: "active",
    }),
    ...directory("groups", "Довідники", "групу", {
      name: "ІПЗ-11",
      course: 1,
      admission_year: 2026,
      faculty: "Факультет математики та інформатики",
      specialty: "Інженерія програмного забезпечення",
    }),
    ...directory("streams", "Довідники", "потік", { name: "Потік ІПЗ-1", group_ids: [3, 4] }),
    ...directory("semesters", "Довідники", "семестру", {
      academic_year: "2027/2028",
      term_number: 1,
      start_date: "2027-09-01",
      end_date: "2027-12-31",
    }),
    ...directory("disciplines", "Довідники", "дисципліну (з призначенням викладача)", {
      name: "Назва дисципліни",
      credits: 4,
      semester_number: 7,
      is_elective: false,
      assignment: { teacher_id: 7, semester_id: 1, target_type: "group", group_id: 1 },
    }),
    "/admin/login-events": {
      get: op({
        tag: "Безпека",
        summary: "Журнал входів (адміністратор)",
        params: [{ name: "limit", in: "query", schema: { type: "integer", default: 100, maximum: 500 } }],
        okSchema: { type: "array", items: generic },
        errors: [401, 403],
      }),
    },
    "/admin/users/{id}/reserve-password": {
      post: op({
        tag: "Безпека",
        summary: "Видати тимчасовий резервний пароль (показується один раз)",
        params: [idParam()],
        ok: 201,
        okSchema: { type: "object", properties: { user_id: { type: "integer" }, email: { type: "string" }, password: { type: "string" } } },
        errors: [401, 403, 404],
      }),
    },
    "/admin/users/{id}/unlock": {
      post: op({
        tag: "Безпека",
        summary: "Зняти блокування облікового запису",
        params: [idParam()],
        okSchema: ref("Message"),
        errors: [401, 403, 404],
      }),
    },
  },
};
