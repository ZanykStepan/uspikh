ALTER TABLE audit_logs ADD COLUMN faculty varchar(200);
CREATE INDEX audit_logs_faculty_idx ON audit_logs (faculty);
