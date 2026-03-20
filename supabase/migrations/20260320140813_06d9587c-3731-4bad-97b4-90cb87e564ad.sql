ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deadline timestamp with time zone;