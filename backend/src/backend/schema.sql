-- Idempotent bootstrap of the tables the app currently reads (see ER.mmd).
-- Replace with a real migration tool once more of the schema lands.

CREATE TABLE IF NOT EXISTS vendor (
    id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL
);

CREATE TABLE IF NOT EXISTS department (
    id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL
);

CREATE TABLE IF NOT EXISTS category (
    id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL
);

CREATE TABLE IF NOT EXISTS asset (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    department_id uuid NOT NULL REFERENCES department (id),
    category_id   uuid NOT NULL REFERENCES category (id)
);

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

-- Added after `person` first shipped, hence ALTER rather than editing the CREATE.
ALTER TABLE person ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES vendor (id);
ALTER TABLE person ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES department (id);

CREATE TABLE IF NOT EXISTS assignee_category (
    person_id   uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES category (id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, category_id)
);
