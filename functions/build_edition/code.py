#input_type_name: BuildEditionInput
#output_type_name: BuildEditionResult
#function_name: build_edition

"""Assemble one morning's paper from rows that already exist.

Deterministic on purpose. The agent's job is judgement — which stories matter,
what to say about them. Which sections exist, what order they run in, and what
number each item carries is arithmetic, and arithmetic a model re-derives every
morning is arithmetic that will differ every morning.

The ordinal is the feature. A PDF has no buttons, so the numbering carries the
whole interaction: you read it on your phone and reply "1 and 3 send, 2 shorter",
and those numbers resolve against `edition_item`.

Section order is your day first, the world second:

    needs_you  drafts waiting on your approval
    ledger     what you promised, what you are owed
    people     relationships overdue against their own cadence
    world      stories, already scored and deduped by the sweep
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

MAX_PER_SECTION = {"needs_you": 8, "ledger": 8, "people": 4, "world": 8}
# A story already printed is the fastest way to lose a daily reader.
DEDUPE_EDITIONS = 14


class BuildEditionInput(BaseModel):
    mailbox_id: str
    edition_date: str | None = None


class BuildEditionResult(BaseModel):
    edition_id: str
    edition_date: str
    items: int
    sections: dict[str, int]
    headline: str
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _age_days(value: Any) -> int | None:
    if not value:
        return None
    try:
        then = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if not then.tzinfo:
        then = then.replace(tzinfo=timezone.utc)
    return int((datetime.now(timezone.utc) - then).total_seconds() // 86400)


def build_edition(ctx: FunctionContext, data: BuildEditionInput) -> BuildEditionResult:
    pod = ctx.pod
    today = data.edition_date or date.today().isoformat()

    # One edition per day: rebuild rather than accumulate duplicates.
    existing = _rows(
        pod.query(f"SELECT id FROM edition WHERE edition_date = {_sql(today)} LIMIT 1")
    )
    if existing:
        edition_id = existing[0]["id"]
        old = _rows(
            pod.query(f"SELECT id FROM edition_item WHERE edition_id = {_sql(edition_id)}")
        )
        if old:
            pod.records.bulk_delete("edition_item", [r["id"] for r in old])
        pod.table("edition").update(edition_id, {"state": "building", "error": None})
    else:
        edition_id = pod.table("edition").create(
            {"edition_date": today, "state": "building"}
        )["id"]

    items: list[dict] = []
    ordinal = 0

    def add(section: str, kind: str, ref_id: str | None, headline: str, detail: str, hint: str):
        nonlocal ordinal
        ordinal += 1
        items.append(
            {
                "edition_id": edition_id,
                "ordinal": ordinal,
                "section": section,
                "kind": kind,
                "ref_id": ref_id,
                "headline": headline[:400],
                "detail": (detail or "")[:1200],
                "action_hint": hint[:200],
            }
        )

    # 1 — drafts waiting on you.
    for row in _rows(
        pod.query(
            "SELECT d.id, d.subject, d.rationale, t.subject AS thread_subject "
            "FROM draft d LEFT JOIN email_thread t ON t.id = d.thread_id "
            "WHERE d.state IN ('proposed', 'edited') "
            f"ORDER BY d.created_at DESC LIMIT {MAX_PER_SECTION['needs_you']}"
        )
    ):
        add(
            "needs_you", "draft", row.get("id"),
            row.get("subject") or row.get("thread_subject") or "Reply ready",
            row.get("rationale") or "",
            "reply with this number to send",
        )

    # 2 — the ledger. What you promised leads: it is the half you can act on.
    for row in _rows(
        pod.query(
            "SELECT c.id, c.text, c.direction, c.due_at, p.email, p.name "
            "FROM commitment c LEFT JOIN person p ON p.id = c.person_id "
            "WHERE c.state = 'open' "
            "ORDER BY (c.direction = 'i_owe') DESC, c.due_at NULLS LAST "
            f"LIMIT {MAX_PER_SECTION['ledger']}"
        )
    ):
        who = row.get("name") or row.get("email") or "someone"
        owed = row.get("direction") == "i_owe"
        due = _age_days(row.get("due_at"))
        overdue = f" · {abs(due)}d overdue" if due is not None and due > 0 else ""
        add(
            "ledger", "commitment", row.get("id"),
            f"{'You owe' if owed else 'Owed to you'}: {row.get('text') or ''}",
            f"{who}{overdue}",
            "reply 'done N' to close it",
        )

    # 3 — people overdue against their OWN cadence, heaviest first.
    for row in _rows(
        pod.query(
            "SELECT id, email, name, cadence_days, last_touch_at FROM person "
            "WHERE state = 'cold' AND cadence_days IS NOT NULL "
            f"ORDER BY weight DESC LIMIT {MAX_PER_SECTION['people']}"
        )
    ):
        silent = _age_days(row.get("last_touch_at"))
        cadence = row.get("cadence_days")
        add(
            "people", "person", row.get("id"),
            f"{row.get('name') or row.get('email')} has gone quiet",
            f"{silent}d since you spoke — you two normally talk every {round(float(cadence))}d",
            "reply 'draft N' for a note",
        )

    # 4 — the world. Never reprint: fingerprints from recent editions are barred.
    printed = {
        r["fingerprint"]
        for r in _rows(
            pod.query(
                "SELECT DISTINCT s.fingerprint FROM story s "
                "JOIN edition e ON e.id = s.printed_in "
                f"WHERE e.edition_date >= {_sql((date.fromisoformat(today) - timedelta(days=DEDUPE_EDITIONS)).isoformat())}"
            )
        )
        if r.get("fingerprint")
    }
    chosen: list[dict] = []
    for row in _rows(
        pod.query(
            "SELECT id, fingerprint, title, url, summary, why FROM story "
            "WHERE printed_in IS NULL ORDER BY score DESC LIMIT 40"
        )
    ):
        if row.get("fingerprint") in printed:
            continue
        chosen.append(row)
        if len(chosen) >= MAX_PER_SECTION["world"]:
            break

    for row in chosen:
        add(
            "world", "story", row.get("id"),
            row.get("title") or "Untitled",
            (row.get("why") or row.get("summary") or ""),
            "reply 'more N' for more like this",
        )

    if items:
        pod.records.bulk_create("edition_item", items)
    if chosen:
        pod.records.bulk_update(
            "story", [{"id": r["id"], "printed_in": edition_id} for r in chosen]
        )

    counts: dict[str, int] = {}
    for item in items:
        counts[item["section"]] = counts.get(item["section"], 0) + 1

    needs = counts.get("needs_you", 0)
    owed = counts.get("ledger", 0)
    headline = (
        f"{needs} to approve, {owed} open commitment{'' if owed == 1 else 's'}"
        if needs or owed
        else "Nothing needs you today"
    )

    pod.table("edition").update(
        edition_id,
        {"state": "ready", "item_count": len(items), "headline": headline},
    )

    return BuildEditionResult(
        edition_id=edition_id,
        edition_date=today,
        items=len(items),
        sections=counts,
        headline=headline,
        message=f"{len(items)} numbered item(s) across {len(counts)} section(s)",
    )
