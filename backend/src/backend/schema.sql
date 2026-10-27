-- Idempotent bootstrap of the tables the app currently reads (see ER.mmd).
-- Replace with a real migration tool once more of the schema lands.

CREATE TABLE IF NOT EXISTS person (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name  text NOT NULL,
    email text NOT NULL,
    phone text,
    role  text NOT NULL CHECK (role IN ('requester', 'assignee', 'supervisor', 'admin'))
);

CREATE UNIQUE INDEX IF NOT EXISTS person_email_lower_key ON person (lower(email));

CREATE TABLE IF NOT EXISTS person_credential (
    person_id     uuid PRIMARY KEY REFERENCES person (id) ON DELETE CASCADE,
    password_hash text NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now()
);
