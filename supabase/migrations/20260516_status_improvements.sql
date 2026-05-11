-- Add next_action fields to jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_action text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_action_due_at timestamptz;
