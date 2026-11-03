-- 1: виправлення оцінки з фіксацією історії
-- До виправлення
SELECT grade_id, student_id, lesson_id, value FROM grades WHERE grade_id = 1;

-- Виправлення оцінки (85 -> 90) та фіксація історії зміни
UPDATE grades SET value = 90, updated_at = now() WHERE grade_id = 1;

INSERT INTO grade_history (grade_id, old_value, new_value, changed_by, reason)
VALUES (1, 85, 90, 7, 'Перерахунок після перевірки практичної роботи');

-- Після виправлення
SELECT grade_id, student_id, lesson_id, value FROM grades WHERE grade_id = 1;

-- Журнал змін
SELECT gh.history_id, u.full_name AS student, gh.old_value, gh.new_value,
       t.full_name AS changed_by, gh.reason
FROM grade_history gh
JOIN grades g ON g.grade_id = gh.grade_id
JOIN users u ON u.user_id = g.student_id
JOIN users t ON t.user_id = gh.changed_by
WHERE gh.grade_id = 1;


-- 2: щорічне переведення груп на наступний курс

-- Стан ДО переведення
SELECT group_id, name, course, status FROM groups ORDER BY group_id;

-- Виклик процедури (один раз на рік, від імені адміністратора user_id=10)
SELECT promote_groups('2025/2026', 10);

-- Стан ПІСЛЯ переведення
SELECT group_id, name, course, status FROM groups ORDER BY group_id;

-- Журнал переведень
SELECT gp.old_name, gp.new_name, gp.from_course, gp.to_course,
       gp.new_status, u.full_name AS promoted_by, gp.promoted_at
FROM group_promotions gp
JOIN users u ON u.user_id = gp.promoted_by
ORDER BY gp.promotion_id;

-- Студенти колишньої ІПЗ-41 тепер випускники
SELECT full_name, status FROM users WHERE group_id = 1;


-- 3: цілісність історичних даних після випуску

SELECT u.full_name, u.status, d.name AS discipline,
       l.lesson_type, l.lesson_date, g.value
FROM grades g
JOIN users u ON u.user_id = g.student_id
JOIN lessons l ON l.lesson_id = g.lesson_id
JOIN teaching_assignments ta ON ta.assignment_id = l.assignment_id
JOIN disciplines d ON d.discipline_id = ta.discipline_id
WHERE u.user_id = 1
ORDER BY l.lesson_date;
