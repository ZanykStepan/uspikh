# Успіх — backend

REST API на Node.js (Express) і PostgreSQL. Маршрути `/api/*` збігаються з прототипом у `server/`, тому інтерфейс працює з обома серверами.

## Запуск

Потрібні Node.js 22.12+ і Docker.

```sh
cd backend
npm install
cp .env.example .env
npm run db:up        # PostgreSQL і Redis
npm run db:reset
npm run dev
```

Сервер: http://127.0.0.1:4000, документація API: http://127.0.0.1:4000/api/docs

Якщо в корені виконано `npm run build`, сервер віддає й інтерфейс. Для розробки інтерфейсу: `npm run dev:api` у корені (Vite на :5173 з проксі на :4000; у `.env` тоді `FRONTEND_URL=http://127.0.0.1:5173`).

Сповіщення доставляються в інтерфейс у реальному часі: Redis pub/sub і потік Server-Sent Events (`GET /api/notifications/stream`). Без Redis сервер працює, але сповіщення передаються лише в межах одного процесу.

## Тести

```sh
npm test
```

Тести працюють з окремою базою `uspikh_test`.

## Структура

```
src/
  routes/        маршрути
  controllers/   обробники запитів
  services/      бізнес-логіка, автентифікація
  repositories/  відповідність таблиць і моделі, транзакції
  middleware/    автентифікація, транзакція на запит, помилки
  domain/        типи занять, шкали, розрахунок балів
  docs/          опис OpenAPI
  seed/          початкові дані
migrations/      SQL-схема
scripts/         migrate, seed
tests/           інтеграційні тести
```

## Автентифікація

Основний вхід — корпоративний акаунт Google (домени `pnu.edu.ua`, `cnu.edu.ua`), обліковий запис створює адміністратор. Резервний вхід — пошта і пароль: користувач задає його сам після входу через пошту або отримує тимчасовий від адміністратора. Після 5 невдалих спроб вхід блокується на 15 хвилин.

Для Google потрібен OAuth client (Web application) з redirect URI `http://127.0.0.1:4000/api/auth/google/callback`; його `GOOGLE_CLIENT_ID` і `GOOGLE_CLIENT_SECRET` вказуються в `.env`.

Демоакаунти: `demo1@pnu.edu.ua` (студент), `demo7` (викладач), `demo9` (куратор), `demo11` (деканат), `demo10` (адміністратор), пароль `Demo2026!`.

## Помилки

```json
{ "status": 404, "message": "Запис не знайдено." }
```
