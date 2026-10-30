"""Seed initial departments, vendors, categories, assets, people, and tickets idempotently.

Run with:
    JWT_SECRET=... uv run python -m backend.seed
"""

import asyncio
from datetime import UTC, datetime
from uuid import UUID

from psycopg_pool import AsyncConnectionPool

from backend.config import get_settings
from backend.schemas.enums import AttachmentKind, Role, TicketPriority, TicketStatus
from backend.security import hash_password


async def seed_database() -> None:
    settings = get_settings()
    pool = AsyncConnectionPool(settings.database.conninfo, open=False)
    await pool.open(wait=True, timeout=10)

    try:
        async with pool.connection() as conn:
            # 1. Departments
            dept_ids: dict[str, UUID] = {}
            for name in (
                "Facilities & Operations",
                "IT Infrastructure",
                "Electrical & Mechanical",
            ):
                cur = await conn.execute(
                    "INSERT INTO department (name) VALUES (%s)"
                    " ON CONFLICT (lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id",
                    (name,),
                )
                row = await cur.fetchone()
                assert row is not None
                dept_ids[name] = row[0]

            # 2. Categories
            cat_ids: dict[str, UUID] = {}
            for name in (
                "HVAC & Climate Control",
                "Electrical Systems",
                "Plumbing & Piping",
                "Network & Telecom",
            ):
                cur = await conn.execute(
                    "INSERT INTO category (name) VALUES (%s)"
                    " ON CONFLICT (lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id",
                    (name,),
                )
                row = await cur.fetchone()
                assert row is not None
                cat_ids[name] = row[0]

            # 3. Vendors
            vendor_ids: dict[str, UUID] = {}
            for name in ("Metro Tech Services", "Apex Mechanical Corp"):
                cur = await conn.execute(
                    "INSERT INTO vendor (name) VALUES (%s)"
                    " ON CONFLICT (lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id",
                    (name,),
                )
                row = await cur.fetchone()
                assert row is not None
                vendor_ids[name] = row[0]

            # 4. Assets
            assets = [
                (
                    "Main Chiller Unit 4B",
                    dept_ids["Facilities & Operations"],
                    cat_ids["HVAC & Climate Control"],
                ),
                (
                    "Switchgear Substation 2",
                    dept_ids["Electrical & Mechanical"],
                    cat_ids["Electrical Systems"],
                ),
                (
                    "Core Router Cluster Alpha",
                    dept_ids["IT Infrastructure"],
                    cat_ids["Network & Telecom"],
                ),
                (
                    "Boiler Tank 1 - Building C",
                    dept_ids["Facilities & Operations"],
                    cat_ids["Plumbing & Piping"],
                ),
            ]
            asset_ids: dict[str, UUID] = {}
            for name, dept_id, cat_id in assets:
                cur = await conn.execute(
                    "SELECT id FROM asset WHERE name = %s LIMIT 1", (name,)
                )
                existing = await cur.fetchone()
                if existing:
                    asset_ids[name] = existing[0]
                else:
                    cur = await conn.execute(
                        "INSERT INTO asset (name, department_id, category_id) VALUES (%s, %s, %s) RETURNING id",
                        (name, dept_id, cat_id),
                    )
                    row = await cur.fetchone()
                    assert row is not None
                    asset_ids[name] = row[0]

            # Link vendors to assets
            for asset_id in asset_ids.values():
                for vendor_id in vendor_ids.values():
                    await conn.execute(
                        "INSERT INTO asset_vendor (asset_id, vendor_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        (asset_id, vendor_id),
                    )

            # 5. Accounts
            accounts = [
                (
                    "Administrator",
                    settings.admin_email or "admin@example.com",
                    "+1-555-0100",
                    settings.admin_password or "adminpassword123",
                    Role.admin,
                    None,
                    None,
                ),
                (
                    "David Miller",
                    "supervisor@example.com",
                    "+1-555-0101",
                    "supervisorpassword123",
                    Role.supervisor,
                    None,
                    dept_ids["Facilities & Operations"],
                ),
                (
                    "Carlos Mendoza",
                    "assignee@example.com",
                    "+1-555-0102",
                    "assigneepassword123",
                    Role.assignee,
                    vendor_ids["Metro Tech Services"],
                    None,
                ),
                (
                    "Alice Chen",
                    "requester@example.com",
                    "+1-555-0103",
                    "requesterpassword123",
                    Role.requester,
                    None,
                    None,
                ),
            ]
            person_ids: dict[str, UUID] = {}
            for name, email, phone, pwd, role, v_id, d_id in accounts:
                cur = await conn.execute(
                    "SELECT id FROM person WHERE lower(email) = lower(%s)", (email,)
                )
                row = await cur.fetchone()
                if row:
                    p_id = row[0]
                    await conn.execute(
                        "UPDATE person SET name = %s, phone = %s, role = %s, vendor_id = %s, department_id = %s WHERE id = %s",
                        (name, phone, role.value, v_id, d_id, p_id),
                    )
                    # Never touch an existing password: re-running the seed must not
                    # reset a real account to its well-known demo credential.
                    await conn.execute(
                        "INSERT INTO person_credential (person_id, password_hash)"
                        " VALUES (%s, %s) ON CONFLICT (person_id) DO NOTHING",
                        (p_id, hash_password(pwd)),
                    )
                else:
                    cur = await conn.execute(
                        "INSERT INTO person (name, email, phone, role, vendor_id, department_id) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                        (name, email, phone, role.value, v_id, d_id),
                    )
                    inserted = await cur.fetchone()
                    assert inserted is not None
                    p_id = inserted[0]
                    pw_hash = hash_password(pwd)
                    await conn.execute(
                        "INSERT INTO person_credential (person_id, password_hash) VALUES (%s, %s)",
                        (p_id, pw_hash),
                    )
                person_ids[email] = p_id

            # 6. Seed Tickets (if none exist for Alice)
            requester_id = person_ids["requester@example.com"]
            supervisor_id = person_ids["supervisor@example.com"]
            assignee_id = person_ids["assignee@example.com"]
            cur = await conn.execute(
                "SELECT count(*) FROM ticket WHERE requester_id = %s",
                (requester_id,),
            )
            count_row = await cur.fetchone()
            ticket_count = count_row[0] if count_row else 0

            if ticket_count == 0:
                now = datetime.now(UTC)
                # Ticket 1: In progress with Carlos
                chiller_asset = asset_ids["Main Chiller Unit 4B"]
                cur = await conn.execute(
                    "INSERT INTO ticket (title, description, location, priority, status, requester_id, asset_id, supervisor_id, created_at)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (
                        "Main Chiller Unit 4B Compressor Failure",
                        "High temperature alarm triggered on primary chiller. Abnormal acoustic vibration heard in compressor housing.",
                        "Central Utility Plant - Sublevel 1",
                        TicketPriority.critical.value,
                        TicketStatus.in_progress.value,
                        requester_id,
                        chiller_asset,
                        supervisor_id,
                        now,
                    ),
                )
                t1 = (await cur.fetchone())[0]

                # T1 status history
                await conn.execute(
                    "INSERT INTO ticket_status_history (ticket_id, from_status, to_status, changed_by_id, changed_at) VALUES"
                    " (%s, NULL, 'open', %s, %s),"
                    " (%s, 'open', 'assigned', %s, %s),"
                    " (%s, 'assigned', 'in_progress', %s, %s)",
                    (
                        t1,
                        requester_id,
                        now,
                        t1,
                        supervisor_id,
                        now,
                        t1,
                        assignee_id,
                        now,
                    ),
                )

                # T1 assignment
                await conn.execute(
                    "INSERT INTO ticket_assignment (ticket_id, assignee_id, assigned_at) VALUES (%s, %s, %s)",
                    (t1, assignee_id, now),
                )

                # T1 comments
                await conn.execute(
                    "INSERT INTO ticket_comment (ticket_id, author_id, body, created_at) VALUES"
                    " (%s, %s, 'Compressor 2 vibration is at 8.2mm/s. Immediate inspection needed.', %s),"
                    " (%s, %s, 'Assigned Carlos Mendoza from Metro Tech Services.', %s),"
                    " (%s, %s, 'On site now. Bearing lubrication pump replaced; testing cycle.', %s)",
                    (
                        t1,
                        requester_id,
                        now,
                        t1,
                        supervisor_id,
                        now,
                        t1,
                        assignee_id,
                        now,
                    ),
                )

                # T1 attachment
                await conn.execute(
                    "INSERT INTO ticket_attachment (ticket_id, uploaded_by_id, kind, storage_url, uploaded_at) VALUES"
                    " (%s, %s, %s, %s, %s)",
                    (
                        t1,
                        requester_id,
                        AttachmentKind.issue_evidence.value,
                        "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800",
                        now,
                    ),
                )

                # Ticket 2: Assigned
                cur = await conn.execute(
                    "INSERT INTO ticket (title, description, location, priority, status, requester_id, asset_id, supervisor_id, created_at)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (
                        "Executive Boardroom HVAC Temp Fluctuations",
                        "Zone thermostat reading 78F despite 68F setpoint. Meeting scheduled at 2 PM.",
                        "Tower 1, 14th Floor, Room 1402",
                        TicketPriority.high.value,
                        TicketStatus.assigned.value,
                        requester_id,
                        chiller_asset,
                        supervisor_id,
                        now,
                    ),
                )
                t2 = (await cur.fetchone())[0]
                await conn.execute(
                    "INSERT INTO ticket_status_history (ticket_id, from_status, to_status, changed_by_id, changed_at) VALUES"
                    " (%s, NULL, 'open', %s, %s),"
                    " (%s, 'open', 'assigned', %s, %s)",
                    (
                        t2,
                        requester_id,
                        now,
                        t2,
                        supervisor_id,
                        now,
                    ),
                )
                await conn.execute(
                    "INSERT INTO ticket_assignment (ticket_id, assignee_id, assigned_at) VALUES (%s, %s, %s)",
                    (t2, assignee_id, now),
                )

                # Ticket 3: Open (Triage queue)
                cur = await conn.execute(
                    "INSERT INTO ticket (title, description, location, priority, status, requester_id, created_at)"
                    " VALUES (%s, %s, %s, %s, 'open', %s, %s) RETURNING id",
                    (
                        "Fiber Switch Port 24 Flapping",
                        "Intermittent packet loss reported on 3rd floor marketing department trunk line.",
                        "Server Room B - Rack 12",
                        TicketPriority.high.value,
                        requester_id,
                        now,
                    ),
                )
                t3 = (await cur.fetchone())[0]
                await conn.execute(
                    "INSERT INTO ticket_status_history (ticket_id, from_status, to_status, changed_by_id, changed_at) VALUES"
                    " (%s, NULL, 'open', %s, %s)",
                    (t3, requester_id, now),
                )

                # Ticket 4: Open (Triage queue)
                cur = await conn.execute(
                    "INSERT INTO ticket (title, description, location, priority, status, requester_id, created_at)"
                    " VALUES (%s, %s, %s, %s, 'open', %s, %s) RETURNING id",
                    (
                        "Water Pressure Drop in Restroom 2A",
                        "Low pressure across all fixtures on second floor west wing.",
                        "Building C - 2nd Floor",
                        TicketPriority.medium.value,
                        requester_id,
                        now,
                    ),
                )
                t4 = (await cur.fetchone())[0]
                await conn.execute(
                    "INSERT INTO ticket_status_history (ticket_id, from_status, to_status, changed_by_id, changed_at) VALUES"
                    " (%s, NULL, 'open', %s, %s)",
                    (t4, requester_id, now),
                )

                # Ticket 5: Resolved / Closed
                cur = await conn.execute(
                    "INSERT INTO ticket (title, description, location, priority, status, requester_id, created_at, closed_at)"
                    " VALUES (%s, %s, %s, %s, 'closed', %s, %s, %s) RETURNING id",
                    (
                        "Emergency Exit Light Battery Replacement",
                        "Quarterly routine maintenance and battery pack inspection.",
                        "East Wing Stairwell 4",
                        TicketPriority.low.value,
                        requester_id,
                        now,
                        now,
                    ),
                )
                t5 = (await cur.fetchone())[0]
                await conn.execute(
                    "INSERT INTO ticket_status_history (ticket_id, from_status, to_status, changed_by_id, changed_at) VALUES"
                    " (%s, NULL, 'open', %s, %s),"
                    " (%s, 'open', 'closed', %s, %s)",
                    (
                        t5,
                        requester_id,
                        now,
                        t5,
                        requester_id,
                        now,
                    ),
                )

        print("Database seeded successfully with initial operational data.")
    finally:
        await pool.close()


def main() -> None:
    asyncio.run(seed_database())


if __name__ == "__main__":
    main()
