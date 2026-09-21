#input_type_name: DerivePeopleInput
#output_type_name: DerivePeopleResult
#function_name: derive_people

"""Build the people list from the mail. No model involved.

Who you talk to, how often, and when you last did are arithmetic over rows you
already have. Sending that to an agent would be slower, dearer and less
repeatable — "deterministic before model". The agent's job starts where judgement
does: what a person is to you, and what you owe them.

Cadence is the column that earns this table its place. "6 weeks since Priya"
is noise; "6 weeks, and you two normally talk every 10 days" is a signal you can
act on. It is measured over the last 12 months only — a relationship that was
weekly in 2024 and quarterly now should read as quarterly.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

CADENCE_WINDOW_DAYS = 365

# Local parts that are a system, not a person. A thread can be `corpus` — you
# replied in it — while the address that sent it is a robot: `classroom@…`
# turned up with a 9-message history and a 0.1-day "cadence", which is a cron
# job, not a relationship. Left in, these crowd the people list and, worse,
# arrive in the briefing as someone worth catching up with.
AUTOMATED_LOCAL_PARTS = {
    "noreply", "no-reply", "donotreply", "do-not-reply", "notifications",
    "notification", "alerts", "alert", "mailer", "mailer-daemon", "bounce",
    "bounces", "postmaster", "automated", "auto", "robot", "bot", "system",
    "support", "billing", "receipts", "invoice", "invoices", "updates",
    "newsletter", "news", "digest", "team", "hello", "info", "contact",
    "admin", "classroom", "calendar-notification",
}
# Anything faster than this over several messages is a machine on a timer.
MIN_HUMAN_CADENCE_DAYS = 0.5
# Below this, "how often do we talk" is not a rate, it is an anecdote.
MIN_EXCHANGES_FOR_CADENCE = 3


class DerivePeopleInput(BaseModel):
    mailbox_id: str


class DerivePeopleResult(BaseModel):
    people: int
    created: int
    updated: int
    cold: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql_str(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _looks_automated(email: str, count: int, cadence: float | None) -> bool:
    local = email.split("@", 1)[0].lower()
    base = local.split("+", 1)[0]
    if base in AUTOMATED_LOCAL_PARTS:
        return True
    if any(base.startswith(f"{p}-") or base.endswith(f"-{p}") for p in ("noreply", "no-reply", "notifications", "alerts")):
        return True
    if cadence is not None and cadence < MIN_HUMAN_CADENCE_DAYS and count > 3:
        return True
    return False


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def derive_people(ctx: FunctionContext, data: DerivePeopleInput) -> DerivePeopleResult:
    pod = ctx.pod
    mailbox = pod.table("mailbox").get(data.mailbox_id)
    me = (mailbox.get("email") or "").lower()
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(days=CADENCE_WINDOW_DAYS)).isoformat()

    # Aggregate in the datastore rather than pulling 1,300 rows over the wire.
    # Only corpus threads count: a newsletter's sender is not a person you know.
    inbound = _rows(
        pod.query(
            "SELECT m.from_email AS email, MAX(m.from_name) AS name, COUNT(*) AS n, "
            "MIN(m.sent_at) AS first_at, MAX(m.sent_at) AS last_at, "
            "COUNT(DISTINCT m.thread_id) AS threads "
            "FROM email_message m JOIN email_thread t ON t.id = m.thread_id "
            "WHERE m.direction = 'inbound' AND m.from_email IS NOT NULL "
            "AND t.tier = 'corpus' "
            f"AND m.from_email <> {_sql_str(me)} "
            "GROUP BY m.from_email"
        )
    )

    # Recent exchanges only, for the rate.
    recent = _rows(
        pod.query(
            "SELECT m.from_email AS email, COUNT(*) AS n, "
            "MIN(m.sent_at) AS first_at, MAX(m.sent_at) AS last_at "
            "FROM email_message m JOIN email_thread t ON t.id = m.thread_id "
            "WHERE m.direction = 'inbound' AND m.from_email IS NOT NULL "
            "AND t.tier = 'corpus' "
            f"AND m.from_email <> {_sql_str(me)} "
            f"AND m.sent_at >= {_sql_str(window_start)} "
            "GROUP BY m.from_email"
        )
    )
    recent_by_email = {r["email"]: r for r in recent if r.get("email")}

    # When you last wrote TO them, from the thread's participant list.
    outbound = _rows(
        pod.query(
            "SELECT t.participants, MAX(m.sent_at) AS last_at "
            "FROM email_message m JOIN email_thread t ON t.id = m.thread_id "
            "WHERE m.direction = 'outbound' AND t.tier = 'corpus' "
            "GROUP BY t.participants"
        )
    )
    last_outbound: dict[str, str] = {}
    for row in outbound:
        participants = row.get("participants") or []
        if isinstance(participants, str):
            continue
        for address in participants:
            address = str(address).lower()
            if address == me:
                continue
            seen = last_outbound.get(address)
            if not seen or str(row.get("last_at") or "") > seen:
                last_outbound[address] = str(row.get("last_at") or "")

    existing = {
        row["email"]: row
        for row in _rows(pod.query("SELECT id, email, state FROM person"))
        if row.get("email")
    }

    to_create: list[dict] = []
    to_update: list[dict] = []
    cold = 0

    for row in inbound:
        email = (row.get("email") or "").lower()
        if not email or "@" not in email:
            continue

        count = int(row.get("n") or 0)
        first_at = _parse(row.get("first_at"))
        last_in = _parse(row.get("last_at"))
        last_out = _parse(last_outbound.get(email))
        last_touch = max([d for d in (last_in, last_out) if d], default=None)

        cadence = None
        window = recent_by_email.get(email)
        if window:
            window_n = int(window.get("n") or 0)
            start = _parse(window.get("first_at"))
            end = _parse(window.get("last_at"))
            if window_n >= MIN_EXCHANGES_FOR_CADENCE and start and end and end > start:
                cadence = (end - start).total_seconds() / 86400 / (window_n - 1)

        if _looks_automated(email, count, cadence):
            continue

        # Volume, but damped — someone who sent 400 automated notices is not four
        # hundred times more important than a co-founder who sent one.
        weight = min(1.0, (count ** 0.5) / 10) + (0.3 if last_out else 0)

        # Cold is a rate judgement, not a calendar one: overdue relative to how
        # often you two normally speak, not "more than 30 days".
        state = "active"
        if cadence and last_touch:
            overdue = (now - last_touch).total_seconds() / 86400
            if overdue > max(cadence * 3, 21):
                state = "cold"
                cold += 1

        fields = {
            "name": (row.get("name") or None),
            "first_seen_at": first_at.isoformat() if first_at else None,
            "last_touch_at": last_touch.isoformat() if last_touch else None,
            "last_inbound_at": last_in.isoformat() if last_in else None,
            "last_outbound_at": last_out.isoformat() if last_out else None,
            "cadence_days": round(cadence, 1) if cadence else None,
            "thread_count": int(row.get("threads") or 0),
            "message_count": count,
            "weight": round(weight, 3),
            "state": state,
        }

        found = existing.get(email)
        if found:
            # Never clobber an archive: that was a human decision.
            if found.get("state") == "archived":
                fields.pop("state", None)
            to_update.append({"id": found["id"], **fields})
        else:
            to_create.append({"email": email, **fields})

    for i in range(0, len(to_create), 200):
        pod.records.bulk_create("person", to_create[i : i + 200])
    for i in range(0, len(to_update), 200):
        pod.records.bulk_update("person", to_update[i : i + 200])

    return DerivePeopleResult(
        people=len(to_create) + len(to_update),
        created=len(to_create),
        updated=len(to_update),
        cold=cold,
        message=(
            f"{len(to_create)} new, {len(to_update)} refreshed, {cold} overdue "
            "relative to their own cadence"
        ),
    )
