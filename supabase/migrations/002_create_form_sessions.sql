-- Progressive form capture table
-- Stores partial and completed form sessions from the ConstrAction wizard
create table if not exists form_sessions (
  id              uuid         primary key default gen_random_uuid(),
  session_id      text         not null unique,   -- generated client-side, persisted in localStorage
  step_reached    int          not null default 0, -- highest step the user reached
  completed       boolean      not null default false,

  -- Extracted key fields for easy querying / GHL autofill
  first_name      text,
  last_name       text,
  email           text,
  phone           text,
  project_name    text,

  -- Full wizard state as-is (APP.data)
  form_data       jsonb        not null default '{}',

  -- GHL contact ID, populated when the session is complete and contact is created
  ghl_contact_id  text,

  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now()
);

-- Indexes for common queries
create index if not exists form_sessions_email_idx      on form_sessions (email);
create index if not exists form_sessions_completed_idx  on form_sessions (completed);
create index if not exists form_sessions_updated_idx    on form_sessions (updated_at desc);
