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

CREATE TABLE IF NOT EXISTS ticket (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title         text NOT NULL,
    description   text NOT NULL,
    location      text NOT NULL,
    priority      text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status        text NOT NULL CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    closed_at     timestamptz,
    requester_id  uuid NOT NULL REFERENCES person (id),
    asset_id      uuid REFERENCES asset (id),
    supervisor_id uuid REFERENCES person (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ticket_requester_idx ON ticket (requester_id);
CREATE INDEX IF NOT EXISTS ticket_asset_idx ON ticket (asset_id);
CREATE INDEX IF NOT EXISTS ticket_status_idx ON ticket (status);

CREATE TABLE IF NOT EXISTS ticket_status_history (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id     uuid NOT NULL REFERENCES ticket (id) ON DELETE CASCADE,
    from_status   text,
    to_status     text NOT NULL,
    changed_by_id uuid NOT NULL REFERENCES person (id),
    changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_status_history_ticket_idx
    ON ticket_status_history (ticket_id, changed_at);

CREATE TABLE IF NOT EXISTS ticket_assignment (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id     uuid NOT NULL REFERENCES ticket (id) ON DELETE CASCADE,
    assignee_id   uuid NOT NULL REFERENCES person (id),
    assigned_at   timestamptz NOT NULL DEFAULT now(),
    unassigned_at timestamptz
);

CREATE INDEX IF NOT EXISTS ticket_assignment_ticket_idx ON ticket_assignment (ticket_id);
-- A person is "currently assigned" at most once per ticket.
CREATE UNIQUE INDEX IF NOT EXISTS ticket_assignment_active_key
    ON ticket_assignment (ticket_id, assignee_id) WHERE unassigned_at IS NULL;

CREATE TABLE IF NOT EXISTS ticket_attachment (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id      uuid NOT NULL REFERENCES ticket (id) ON DELETE CASCADE,
    uploaded_by_id uuid NOT NULL REFERENCES person (id),
    kind           text NOT NULL CHECK (kind IN ('issue_evidence', 'completion_proof')),
    storage_url    text NOT NULL,
    uploaded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_attachment_ticket_idx ON ticket_attachment (ticket_id);

CREATE TABLE IF NOT EXISTS ticket_comment (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id  uuid NOT NULL REFERENCES ticket (id) ON DELETE CASCADE,
    author_id  uuid NOT NULL REFERENCES person (id),
    body       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_comment_ticket_idx ON ticket_comment (ticket_id, created_at);

-- Names are how admins and supervisors tell these apart, so keep them unique.
CREATE UNIQUE INDEX IF NOT EXISTS department_name_lower_key ON department (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS vendor_name_lower_key ON vendor (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS category_name_lower_key ON category (lower(name));

-- Vendors are responsible for (the contact for repairing) the assets they are linked to.
CREATE TABLE IF NOT EXISTS asset_vendor (
    asset_id  uuid NOT NULL REFERENCES asset (id) ON DELETE CASCADE,
    vendor_id uuid NOT NULL REFERENCES vendor (id),
    PRIMARY KEY (asset_id, vendor_id)
);

-- Superseded by asset_vendor: assignees now qualify through their vendor.
DROP TABLE IF EXISTS assignee_category;
