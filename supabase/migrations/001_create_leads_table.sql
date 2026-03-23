-- Create leads table to store GHL form submissions
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  email text,
  phone text,
  message text,
  source text default 'ghl_form',
  ghl_contact_id text,         -- populated after GHL contact is created
  raw_payload jsonb,           -- full raw webhook payload from GHL
  created_at timestamptz default now()
);

-- Index for quick lookup by email
create index if not exists leads_email_idx on leads (email);
