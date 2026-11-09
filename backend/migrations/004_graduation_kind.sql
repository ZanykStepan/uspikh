ALTER TABLE graduations ADD COLUMN kind varchar(20) NOT NULL DEFAULT 'diploma' CHECK (kind IN ('diploma', 'certificate'));
