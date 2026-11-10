ALTER TABLE weight_schemes ADD COLUMN method varchar(20) NOT NULL DEFAULT 'weighted' CHECK (method IN ('weighted', 'average'));
