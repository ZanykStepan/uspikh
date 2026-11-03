INSERT INTO groups (name, admission_year, course, faculty) VALUES
    ('ІПЗ-41', 2022, 4, 'Факультет математики та інформатики'),
    ('ІПЗ-42', 2022, 4, 'Факультет математики та інформатики'),
    ('ІПЗ-31', 2023, 3, 'Факультет математики та інформатики');

INSERT INTO semesters (academic_year, term_number, start_date, end_date, is_current) VALUES
    ('2025/2026', 1, '2025-09-01', '2026-01-24', TRUE);

INSERT INTO users (full_name, email, password_hash, role, group_id, enrollment_year) VALUES
    ('Заник Степан Петрович',      'zanyk.s@pnu.edu.ua',     'hash1', 'student', 1, 2022),
    ('Іванова Марія Олегівна',     'ivanova.m@pnu.edu.ua',   'hash2', 'student', 1, 2022),
    ('Петренко Олег Іванович',     'petrenko.o@pnu.edu.ua',  'hash3', 'student', 1, 2022),
    ('Коваль Ірина Богданівна',    'koval.i@pnu.edu.ua',     'hash4', 'student', 2, 2022),
    ('Бойко Андрій Васильович',    'boiko.a@pnu.edu.ua',     'hash5', 'student', 2, 2022),
    ('Гринів Христина Юріївна',    'hryniv.h@pnu.edu.ua',    'hash10','student', 3, 2023);

INSERT INTO users (full_name, email, password_hash, role) VALUES
    ('Пікуляк Микола Васильович',    'pikuliak.m@pnu.edu.ua',   'hash6', 'teacher'),
    ('Савка Іван Ярославович',       'savka.i@pnu.edu.ua',      'hash7', 'teacher'),
    ('Кузь Микола Васильович',       'kuz.m@pnu.edu.ua',        'hash8', 'curator'),
    ('Незамай Борис Сергійович',     'nezamai.b@pnu.edu.ua',    'hash9', 'admin');

INSERT INTO disciplines (name, credits, semester_number, is_elective) VALUES
    ('Професійна практика програмної інженерії',  5, 7, FALSE),
    ('Бази даних',                                4, 7, FALSE),
    ('Web-дизайн',                                4, 7, FALSE),
    ('Безпека програм і даних',                   3, 7, TRUE),
    ('Програмування мовою Python',                3, 7, TRUE);

INSERT INTO teaching_assignments (teacher_id, discipline_id, group_id, semester_id) VALUES
    (7, 1, 1, 1),
    (7, 1, 2, 1),
    (8, 2, 1, 1),
    (8, 3, 2, 1);

INSERT INTO lessons (assignment_id, lesson_date, lesson_type, topic) VALUES
    (1, '2025-10-05', 'практична', 'Аналіз вимог: практична робота №1'),
    (1, '2025-11-10', 'модуль',    'Модульний контроль №1'),
    (1, '2026-01-15', 'залік',     'Підсумковий залік'),
    (2, '2025-10-05', 'практична', 'Аналіз вимог: практична робота №1'),
    (3, '2025-10-06', 'практична', 'SQL: практична робота №1'),
    (4, '2025-10-06', 'практична', 'React: практична робота №1'),
    (4, '2026-01-16', 'залік',     'Підсумковий залік');

INSERT INTO grades (student_id, lesson_id, value, recorded_by) VALUES
    (1, 1, 85, 7), (1, 2, 90, 7), (1, 3, 88, 7),
    (2, 1, 70, 7), (2, 3, 75, 7),
    (3, 1, 55, 7),
    (4, 6, 92, 8), (4, 7, 95, 8),
    (5, 6, 60, 8);

INSERT INTO attendance (student_id, lesson_id, status, reason) VALUES
    (1, 1, 'present', NULL),
    (1, 4, 'absent',  'поважна'),
    (2, 1, 'present', NULL),
    (3, 1, 'absent',  'неповажна'),
    (3, 4, 'absent',  'неповажна');

INSERT INTO debts (student_id, discipline_id, semester_id, deadline, status) VALUES
    (3, 1, 1, '2026-02-15', 'open');

INSERT INTO elective_enrollments (student_id, discipline_id, semester_id, status) VALUES
    (1, 5, 1, 'approved'),
    (2, 5, 1, 'pending'),
    (4, 4, 1, 'approved');

INSERT INTO notifications (user_id, message, is_read) VALUES
    (3, 'Виникла академічна заборгованість з дисципліни «Професійна практика програмної інженерії»', FALSE),
    (1, 'Вашу заявку на вибіркову дисципліну «Програмування мовою Python» підтверджено', TRUE);

SELECT 'groups' AS table_name, COUNT(*) FROM groups
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'disciplines', COUNT(*) FROM disciplines
UNION ALL SELECT 'teaching_assignments', COUNT(*) FROM teaching_assignments
UNION ALL SELECT 'lessons', COUNT(*) FROM lessons
UNION ALL SELECT 'grades', COUNT(*) FROM grades
UNION ALL SELECT 'attendance', COUNT(*) FROM attendance
UNION ALL SELECT 'debts', COUNT(*) FROM debts
UNION ALL SELECT 'elective_enrollments', COUNT(*) FROM elective_enrollments
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications;
