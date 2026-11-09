ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
DROP TABLE recovery_codes;
