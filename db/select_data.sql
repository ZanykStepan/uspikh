-- Запит 1 — Середній бал студента з дисципліни
SELECT u.full_name AS student, d.name AS discipline,
       ROUND(AVG(g.value), 1) AS avg_score
FROM grades g
JOIN users u ON u.user_id = g.student_id
JOIN lessons l ON l.lesson_id = g.lesson_id
JOIN teaching_assignments ta ON ta.assignment_id = l.assignment_id
JOIN disciplines d ON d.discipline_id = ta.discipline_id
GROUP BY u.full_name, d.name
ORDER BY avg_score DESC;

-- Запит 2 — Рейтинг студентів у межах групи
SELECT gr.name AS group_name, u.full_name AS student,
       ROUND(AVG(g.value), 1) AS semester_score
FROM grades g
JOIN users u ON u.user_id = g.student_id
JOIN groups gr ON gr.group_id = u.group_id
GROUP BY u.full_name, gr.name
ORDER BY gr.name, semester_score DESC;

-- Запит 3 — Студенти з відкритими академічними заборгованостями
SELECT u.full_name AS student, d.name AS discipline,
       db.deadline, db.status
FROM debts db
JOIN users u ON u.user_id = db.student_id
JOIN disciplines d ON d.discipline_id = db.discipline_id
WHERE db.status = 'open';

-- Запит 4 — Статистика пропусків за студентами
SELECT u.full_name AS student,
       SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) AS absences,
       SUM(CASE WHEN a.status='absent' AND a.reason='неповажна'
                THEN 1 ELSE 0 END) AS unexcused
FROM attendance a
JOIN users u ON u.user_id = a.student_id
GROUP BY u.full_name
ORDER BY absences DESC;

-- Запит 5 — Заявки студентів на вибіркові дисципліни
SELECT u.full_name AS student, d.name AS elective_discipline,
       ee.status, ee.enrolled_at
FROM elective_enrollments ee
JOIN users u ON u.user_id = ee.student_id
JOIN disciplines d ON d.discipline_id = ee.discipline_id
ORDER BY ee.enrolled_at;

-- Запит 6 — Навантаження викладачів (дисципліни та групи)
SELECT t.full_name AS teacher, d.name AS discipline,
       g.name AS group_name
FROM teaching_assignments ta
JOIN users t ON t.user_id = ta.teacher_id
JOIN disciplines d ON d.discipline_id = ta.discipline_id
JOIN groups g ON g.group_id = ta.group_id
ORDER BY t.full_name;

-- Запит 7 — Журнал оцінок за конкретне заняття (lesson_id = 1)
SELECT l.lesson_date, l.lesson_type, l.topic,
       u.full_name AS student, g.value
FROM grades g
JOIN lessons l ON l.lesson_id = g.lesson_id
JOIN users u ON u.user_id = g.student_id
WHERE g.lesson_id = 1;

-- ПЕРЕВІРКА ОБМЕЖЕНЬ (кожен рядок має завершитись помилкою)

-- Оцінка поза шкалою 0..100 -> порушення CHECK
-- INSERT INTO grades (student_id, lesson_id, value, recorded_by) VALUES (1, 1, 150, 7);

-- Оцінка неіснуючому студенту -> порушення FOREIGN KEY
-- INSERT INTO grades (student_id, lesson_id, value, recorded_by) VALUES (9999, 1, 80, 7);

-- Дублікат email -> порушення UNIQUE
-- INSERT INTO users (full_name, email, password_hash, role) VALUES ('Тест Тестович', 'zanyk.s@pnu.edu.ua', 'x', 'student');
