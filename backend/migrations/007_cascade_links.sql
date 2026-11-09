ALTER TABLE assignment_roster DROP CONSTRAINT assignment_roster_student_id_fkey;
ALTER TABLE assignment_roster ADD CONSTRAINT assignment_roster_student_id_fkey FOREIGN KEY (student_id) REFERENCES users(user_id) ON DELETE CASCADE;
ALTER TABLE curator_groups DROP CONSTRAINT curator_groups_group_id_fkey;
ALTER TABLE curator_groups ADD CONSTRAINT curator_groups_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE;
