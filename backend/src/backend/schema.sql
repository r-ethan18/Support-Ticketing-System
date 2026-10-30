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

-- Uploaded files live in object storage; these describe them. Rows without an
-- object_key are older links to external images and keep using storage_url.
ALTER TABLE ticket_attachment ADD COLUMN IF NOT EXISTS object_key text;
ALTER TABLE ticket_attachment ADD COLUMN IF NOT EXISTS filename text;
ALTER TABLE ticket_attachment ADD COLUMN IF NOT EXISTS content_type text;
ALTER TABLE ticket_attachment ADD COLUMN IF NOT EXISTS size_bytes bigint;
ALTER TABLE ticket_attachment ALTER COLUMN storage_url DROP NOT NULL;

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

-- Failed-login counters, shared by every replica. `key` is e.g. "login:<email>|<ip>".
CREATE TABLE IF NOT EXISTS login_throttle (
    key               text PRIMARY KEY,
    failures          integer NOT NULL,
    window_started_at timestamptz NOT NULL,
    locked_until      timestamptz
);

-- Opaque refresh tokens (only the SHA-256 of the token is stored). Each refresh
-- retires the presented token and issues a successor in the same family; a
-- retired token turning up again means theft, so the whole family is revoked.
CREATE TABLE IF NOT EXISTS refresh_token (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id  uuid NOT NULL,
    person_id  uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS refresh_token_person_idx ON refresh_token (person_id);
CREATE INDEX IF NOT EXISTS refresh_token_family_idx ON refresh_token (family_id);

-- Deleting a person never destroys what other people are involved in: tickets,
-- comments, uploads, history and past assignments are kept with the person
-- blanked (a "deleted user"). `ticket.supervisor_id` already behaves that way.
ALTER TABLE ticket ALTER COLUMN requester_id DROP NOT NULL;
ALTER TABLE ticket_assignment ALTER COLUMN assignee_id DROP NOT NULL;
ALTER TABLE ticket_attachment ALTER COLUMN uploaded_by_id DROP NOT NULL;
ALTER TABLE ticket_comment ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE ticket_status_history ALTER COLUMN changed_by_id DROP NOT NULL;

DO $$
DECLARE
    fk record;
BEGIN
    FOR fk IN
        SELECT * FROM (VALUES
            ('ticket', 'requester_id', 'person', 'n'),
            ('ticket_assignment', 'assignee_id', 'person', 'n'),
            ('ticket_attachment', 'uploaded_by_id', 'person', 'n'),
            ('ticket_comment', 'author_id', 'person', 'n'),
            ('ticket_status_history', 'changed_by_id', 'person', 'n')
        ) AS v (tbl, col, ref, on_delete)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            WHERE c.contype = 'f'
              AND c.conrelid = fk.tbl::regclass
              AND c.confrelid = fk.ref::regclass
              AND c.confdeltype = fk.on_delete::"char"
              AND c.conkey = ARRAY[(
                  SELECT attnum FROM pg_attribute
                  WHERE attrelid = fk.tbl::regclass AND attname = fk.col
              )]
        ) THEN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
                           fk.tbl, fk.tbl || '_' || fk.col || '_fkey');
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I (id) ON DELETE %s',
                fk.tbl, fk.tbl || '_' || fk.col || '_fkey', fk.col, fk.ref,
                CASE fk.on_delete WHEN 'c' THEN 'CASCADE' ELSE 'SET NULL' END);
        END IF;
    END LOOP;
END $$;
