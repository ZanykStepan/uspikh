ALTER TABLE groups ADD COLUMN program_years integer NOT NULL DEFAULT 4 CHECK (program_years IN (2, 3, 4, 5, 6));
ALTER TABLE groups ADD CONSTRAINT groups_course_within_program CHECK (course <= program_years);
ALTER TABLE users DROP CONSTRAINT users_student_status_check;
ALTER TABLE users ADD CONSTRAINT users_student_status_check CHECK (student_status IN ('active', 'graduated', 'dismissed', 'repeat_pending'));
