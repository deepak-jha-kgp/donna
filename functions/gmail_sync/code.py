#input_type_name: GmailSyncInput
#output_type_name: GmailSyncResult
#function_name: gmail_sync

"""One Gmail sync, driven by a phase on the cursor.

Backfill and live sync are the SAME code path on purpose. Two paths drift, and
the drift shows up months later as a hole in search shaped like one month of
2025. The only difference between them is the query and the phase they start in.

Backfill is three passes, because Gmail can answer "what did I reply to" far
more cheaply than we can work it out ourselves:

    corpus_sent  in:sent after:<cutoff>   -> your sent mail. Voice samples, and
                                             every thread they touch is corpus.
    corpus_fill  per-thread fetch         -> the rest of those conversations.
    index_only   after:<cutoff> -in:sent  -> everything else, metadata only.

Tier 2 is the point. Newsletters, receipts and notifications are most of any
mailbox; indexing them buries the twelve threads that matter under four thousand
that don't.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from email.utils import getaddresses
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

AUTH_CONFIG = "gmail"
PAGE_SIZE = 50
THREADS_PER_CALL = 8
MAIL_ROOT = "/me/mail"

PHASE_ORDER = ["corpus_sent", "corpus_fill", "index_only", "done"]


class GmailSyncInput(BaseModel):
    mailbox_id: str
    # "backfill" walks history; "incremental" picks up what arrived since.
    mode: str = "backfill"
    # Bounded work per invocation so the caller can show progress and resume.
    max_pages: int = 4


class GmailSyncResult(BaseModel):
    phase: str
    processed: int
    threads_touched: int
    done: bool
    progress_done: int
    progress_total: int | None = None
    message: str


# Gmail has already classified this mail and the answer is sitting in labelIds.
# Reinventing it with sender heuristics ("noreply@", "unsubscribe") would be
# worse and slower than reading what the mailbox already knows.
BULK_CATEGORIES = {
    "CATEGORY_PROMOTIONS",
    "CATEGORY_SOCIAL",
    "CATEGORY_FORUMS",
    "CATEGORY_UPDATES",
}


def _is_correspondence(messages: list[dict], my_email: str = "") -> bool:
    """Is this a conversation with a person, or something addressed to a list?

    Only the inbound messages carry a category; your own sent mail never does.
    A thread with no categorised inbound message at all is treated as
    correspondence, because some Workspace accounts categorise nothing and the
    cost of wrongly excluding a real thread is far higher than the cost of one
    newsletter in the corpus.
    """
    categorised = False
    for message in messages:
        # You having written in this thread outranks any category Gmail assigned.
        # Real conversations do get filed under Updates — a broker thread titled
        # "Re: Group health insurance" was categorised as bulk and is plainly not.
        if my_email and (_first_address(message.get("sender")) or "") == my_email:
            return True
        labels = set(message.get("labelIds") or [])
        if "CATEGORY_PERSONAL" in labels:
            return True
        if labels & BULK_CATEGORIES:
            categorised = True
    return not categorised


def _is_epoch(value: str | None) -> bool:
    """Distinguish a stored epoch watermark from a Gmail page token."""
    return bool(value) and str(value).isdigit()


def _sql_str(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _addresses(raw: Any) -> list[str]:
    """'Deepak Jha <a@b.com>, c@d.com' -> ['a@b.com', 'c@d.com']."""
    if not raw:
        return []
    if isinstance(raw, list):
        raw = ", ".join(str(x) for x in raw if x)
    return [addr.lower() for _, addr in getaddresses([str(raw)]) if addr]


def _first_address(raw: Any) -> str | None:
    found = _addresses(raw)
    return found[0] if found else None


def _display_name(raw: Any) -> str | None:
    if not raw:
        return None
    parsed = getaddresses([str(raw)])
    if parsed and parsed[0][0]:
        return parsed[0][0][:200]
    return None


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _result(response: Any) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    result = (payload or {}).get("result", payload) or {}
    # Composio nests the Gmail body under `data` on some operations and returns
    # it flat on others; accept either rather than guessing.
    if isinstance(result, dict) and "messages" not in result and isinstance(
        result.get("data"), dict
    ):
        return result["data"]
    return result if isinstance(result, dict) else {}


def _fetch(pod: Any, account_id: str, operation: str, payload: dict) -> dict:
    return _result(
        pod.connectors.execute(AUTH_CONFIG, operation, payload, account_id=account_id)
    )


def _thread_document(subject: str | None, messages: list[dict]) -> str:
    """The thread as one markdown document — what actually gets embedded."""
    lines = [f"# {subject or '(no subject)'}", ""]
    for message in sorted(messages, key=lambda m: m.get("messageTimestamp") or ""):
        sender = message.get("sender") or "(unknown)"
        stamp = message.get("messageTimestamp") or ""
        lines.append(f"## {sender} — {stamp}")
        to_line = message.get("to")
        if to_line:
            lines.append(f"*To: {to_line}*")
        lines.append("")
        body = (message.get("messageText") or "").strip()
        if not body:
            preview = message.get("preview") or {}
            body = (preview.get("body") if isinstance(preview, dict) else "") or ""
        lines.append(body.strip() or "*(no text body)*")
        lines.append("")
    return "\n".join(lines)


def _existing_message_ids(pod: Any, gmail_ids: list[str]) -> set[str]:
    if not gmail_ids:
        return set()
    joined = ", ".join(_sql_str(i) for i in gmail_ids)
    found = pod.query(
        f"SELECT gmail_message_id FROM email_message WHERE gmail_message_id IN ({joined})"
    )
    return {r.get("gmail_message_id") for r in _rows(found)}


def _threads_by_gmail_id(pod: Any, gmail_thread_ids: list[str]) -> dict[str, dict]:
    if not gmail_thread_ids:
        return {}
    joined = ", ".join(_sql_str(i) for i in gmail_thread_ids)
    found = pod.query(
        "SELECT id, gmail_thread_id, tier, message_count, corpus_filled "
        f"FROM email_thread WHERE gmail_thread_id IN ({joined})"
    )
    return {r["gmail_thread_id"]: r for r in _rows(found) if r.get("gmail_thread_id")}


def _upsert_threads(
    pod: Any, messages: list[dict], tier: str, my_email: str
) -> dict[str, dict]:
    """Create or promote the threads these messages belong to.

    Batched on purpose. The first cut issued one create/update per thread, which
    is ~40 sequential HTTP calls for a single page of mail and blew the request
    timeout before the page finished. Everything here is at most four calls:
    one read, one bulk create, one bulk update, one read back for the new ids.

    Promotion is one-way: a thread that has ever been corpus stays corpus. An
    index_only page arriving later must never demote a conversation you took
    part in.
    """
    grouped: dict[str, list[dict]] = {}
    for message in messages:
        thread_id = message.get("threadId")
        if thread_id:
            grouped.setdefault(thread_id, []).append(message)
    if not grouped:
        return {}

    known = _threads_by_gmail_id(pod, list(grouped))
    to_create: list[dict] = []
    to_update: list[dict] = []

    for gmail_thread_id, thread_messages in grouped.items():
        newest = max(thread_messages, key=lambda m: m.get("messageTimestamp") or "")
        participants = sorted(
            {
                address
                for message in thread_messages
                for address in _addresses(message.get("sender"))
                + _addresses(message.get("to"))
            }
        )
        # The direction of the NEWEST message, not "any message here is mine".
        # The first cut used `any(...)`, and since corpus_sent only ever fetches
        # `in:sent`, every thread came out "outbound" — a column the triage agent
        # correctly learned to distrust.
        newest_sender = _first_address(newest.get("sender")) or ""
        outbound = newest_sender == my_email
        fields = {
            "subject": (newest.get("subject") or "")[:500] or None,
            "snippet": (_snippet(newest) or "")[:400] or None,
            "participants": participants,
            "last_message_at": newest.get("messageTimestamp"),
            "last_direction": "outbound" if outbound else "inbound",
        }
        existing = known.get(gmail_thread_id)
        if existing:
            changed = dict(fields)
            if tier == "corpus" and existing.get("tier") != "corpus":
                changed["tier"] = "corpus"
                # A thread that just became corpus needs its document built.
                changed["corpus_filled"] = False
            to_update.append({"id": existing["id"], **changed})
        else:
            to_create.append(
                {
                    "gmail_thread_id": gmail_thread_id,
                    "tier": tier,
                    "state": "unreviewed",
                    "message_count": 0,
                    "corpus_filled": False,
                    **fields,
                }
            )

    if to_create:
        pod.records.bulk_create("email_thread", to_create)
    if to_update:
        pod.records.bulk_update("email_thread", to_update)
    return _threads_by_gmail_id(pod, list(grouped))


def _ingest(
    pod: Any,
    messages: list[dict],
    tier: str,
    my_email: str,
    *,
    write_document: bool,
) -> tuple[int, int]:
    """Write new messages and, for corpus threads, the thread document."""
    messages = [m for m in messages if m.get("messageId") and m.get("threadId")]
    if not messages:
        return 0, 0

    already = _existing_message_ids(pod, [m["messageId"] for m in messages])
    fresh = [m for m in messages if m["messageId"] not in already]
    threads = _upsert_threads(pod, messages, tier, my_email)

    if not fresh:
        # No new rows, but the document may still be missing or stale — a thread
        # whose messages were all ingested during corpus_sent lands here every
        # time, and it is precisely the one that needs writing.
        if write_document:
            _write_documents(pod, messages, threads)
        return 0, len(threads)

    rows = []
    for message in fresh:
        thread = threads.get(message["threadId"]) or {}
        sender = _first_address(message.get("sender"))
        rows.append(
            {
                "gmail_message_id": message["messageId"],
                "gmail_thread_id": message["threadId"],
                "thread_id": thread.get("id"),
                "direction": "outbound" if sender == my_email else "inbound",
                "from_email": sender,
                "from_name": _display_name(message.get("sender")),
                "to_emails": _addresses(message.get("to")),
                "cc_emails": _addresses(message.get("cc")),
                "subject": (message.get("subject") or "")[:500] or None,
                "sent_at": message.get("messageTimestamp"),
                "labels": message.get("labelIds") or [],
                "snippet": _snippet(message)[:1000] or None,
                "has_attachments": bool(message.get("attachmentList")),
                "tier": thread.get("tier") or tier,
            }
        )
    pod.records.bulk_create("email_message", rows)

    if write_document:
        # `messages`, not `fresh`: the document is the whole conversation.
        _write_documents(pod, messages, threads)

    _recount(pod, threads)
    return len(rows), len(threads)


def _snippet(message: dict) -> str:
    preview = message.get("preview")
    if isinstance(preview, dict) and preview.get("body"):
        return str(preview["body"])
    return (message.get("messageText") or "").strip()[:1000]


def _write_documents(
    pod: Any, messages: list[dict], threads: dict[str, dict]
) -> None:
    """Write the thread document for every corpus thread in this batch.

    Called from ONE place — the corpus_fill phase, which holds a whole
    conversation at once. Earlier phases deliberately don't write: building a
    document from the two sent messages you happen to have seen, then rebuilding
    it when the rest of the thread arrives, is a wasted write and a worse
    document in between.
    """
    grouped: dict[str, list[dict]] = {}
    for message in messages:
        grouped.setdefault(message["threadId"], []).append(message)

    path_updates: list[dict] = []
    for gmail_thread_id, thread_messages in grouped.items():
        thread = threads.get(gmail_thread_id)
        if not thread or thread.get("tier") != "corpus":
            continue
        path = f"{MAIL_ROOT}/{gmail_thread_id}.md"
        subject = thread.get("subject") or thread_messages[0].get("subject")
        try:
            # No folder grant needed: /me is the invoking user's own tree,
            # reached by delegation. Granting it is in fact rejected.
            pod.files.write_text(path, _thread_document(subject, thread_messages))
        except Exception as exc:  # noqa: BLE001 — one bad body must not stop a backfill
            path_updates.append(
                {"id": thread["id"], "summary": f"document write failed: {exc}"[:400]}
            )
            continue
        if thread.get("body_path") != path:
            path_updates.append({"id": thread["id"], "body_path": path})
    if path_updates:
        pod.records.bulk_update("email_thread", path_updates)


def _recount(pod: Any, threads: dict[str, dict]) -> None:
    if not threads:
        return
    joined = ", ".join(_sql_str(t) for t in threads)
    counted = pod.query(
        "SELECT gmail_thread_id, COUNT(*) AS n FROM email_message "
        f"WHERE gmail_thread_id IN ({joined}) GROUP BY gmail_thread_id"
    )
    updates = []
    for row in _rows(counted):
        thread = threads.get(row.get("gmail_thread_id"))
        if thread and thread.get("message_count") != row.get("n"):
            updates.append({"id": thread["id"], "message_count": int(row.get("n") or 0)})
    if updates:
        pod.records.bulk_update("email_thread", updates)


def _cursor_for(pod: Any, mailbox_id: str, kind: str, cutoff: datetime) -> dict:
    found = pod.query(
        "SELECT * FROM sync_cursor "
        f"WHERE mailbox_id = {_sql_str(mailbox_id)} AND kind = {_sql_str(kind)} LIMIT 1"
    )
    existing = _rows(found)
    if existing:
        return existing[0]
    return pod.table("sync_cursor").create(
        {
            "mailbox_id": mailbox_id,
            "kind": kind,
            "state": "running",
            "phase": "corpus_sent" if kind == "gmail_backfill" else "recent",
            "progress_done": 0,
            "cutoff_at": cutoff.isoformat(),
        }
    )


def gmail_sync(ctx: FunctionContext, data: GmailSyncInput) -> GmailSyncResult:
    pod = ctx.pod
    mailbox = pod.table("mailbox").get(data.mailbox_id)
    account_id = mailbox["account_id"]
    my_email = (mailbox.get("email") or "").lower()

    months = int(mailbox.get("backfill_months") or 24)
    cutoff = datetime.now(timezone.utc) - timedelta(days=months * 31)
    cutoff_epoch = int(cutoff.timestamp())

    kind = "gmail_backfill" if data.mode == "backfill" else "gmail_incremental"
    cursor = _cursor_for(pod, data.mailbox_id, kind, cutoff)
    cursors = pod.table("sync_cursor")

    phase = cursor.get("phase") or ("corpus_sent" if kind == "gmail_backfill" else "recent")
    page_token = cursor.get("cursor")
    processed = 0
    threads_touched = 0
    estimate = cursor.get("progress_total")
    # The watermark is the moment this catch-up STARTED, not the moment it
    # finished — anything delivered while it ran must still be picked up next time.
    started_at: datetime | None = None

    try:
        for _ in range(max(1, data.max_pages)):
            if phase == "done":
                break

            if phase == "corpus_fill":
                filled, touched = _fill_corpus_threads(pod, account_id, my_email)
                processed += filled
                threads_touched += touched
                if touched == 0:
                    # Backfill still owes the index_only sweep; incremental is done.
                    phase = "index_only" if kind == "gmail_backfill" else "done"
                continue

            if phase == "corpus_sent":
                # Metadata only. The bodies arrive in corpus_fill, which sees the
                # whole conversation at once and writes one good document.
                query = f"in:sent after:{cutoff_epoch}"
                tier = "corpus"
            elif phase == "index_only":
                query = f"after:{cutoff_epoch} -in:sent"
                tier = "index_only"
            else:  # recent
                # The stored cursor is an epoch watermark; a page token is not a
                # watermark, so fall back to the cutoff when we hold one.
                stored = cursor.get("cursor")
                since = stored if stored and _is_epoch(stored) else str(cutoff_epoch)
                query = f"after:{since}"
                # Live mail is decided per thread, not in bulk. Backfill can use
                # "did you reply" as its test; live mail cannot, because the whole
                # point is the message you have NOT replied to yet. Gmail's own
                # category is the test instead.
                tier = "per_message"

            payload: dict[str, Any] = {
                "user_id": "me",
                "query": query,
                "max_results": PAGE_SIZE,
                "include_payload": False,
                "verbose": False,
            }
            if page_token and not _is_epoch(page_token):
                payload["page_token"] = page_token

            page = _fetch(pod, account_id, "GMAIL_FETCH_EMAILS", payload)
            messages = page.get("messages") or []
            estimate = page.get("resultSizeEstimate") or estimate

            if tier == "per_message":
                grouped: dict[str, list[dict]] = {}
                for message in messages:
                    grouped.setdefault(message.get("threadId"), []).append(message)
                for bucket in grouped.values():
                    kind_tier = (
                        "corpus" if _is_correspondence(bucket, my_email) else "index_only"
                    )
                    written, touched = _ingest(
                        pod, bucket, kind_tier, my_email, write_document=False
                    )
                    processed += written
                    threads_touched += touched
            else:
                written, touched = _ingest(
                    pod, messages, tier, my_email, write_document=False
                )
                processed += written
                threads_touched += touched

            next_token = page.get("nextPageToken")
            if phase == "recent":
                # Only claim to be caught up once the query is exhausted. The
                # first cut stamped "now" onto the cursor after a single page —
                # so a first incremental run saw the 50 newest messages and
                # declared everything older already synced, losing the gap in
                # between with no error anywhere.
                if next_token:
                    page_token = next_token
                    started_at = started_at or datetime.now(timezone.utc)
                else:
                    page_token = str(
                        int((started_at or datetime.now(timezone.utc)).timestamp())
                    )
                    phase = "corpus_fill"
            elif not next_token:
                phase = "corpus_fill" if phase == "corpus_sent" else "done"
                page_token = None
            else:
                page_token = next_token

        done = phase == "done"
        cursors.update(
            cursor["id"],
            {
                "phase": phase,
                "cursor": page_token,
                "state": "done" if done and kind == "gmail_backfill" else "idle",
                "progress_done": int(cursor.get("progress_done") or 0) + processed,
                "progress_total": estimate,
                "last_run_at": datetime.now(timezone.utc).isoformat(),
                "last_error": None,
            },
        )
    except Exception as exc:  # noqa: BLE001 — the cursor must record why it stopped
        cursors.update(
            cursor["id"],
            {
                "state": "error",
                "phase": phase,
                "cursor": page_token,
                "last_error": str(exc)[:2000],
                "last_run_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        raise

    return GmailSyncResult(
        phase=phase,
        processed=processed,
        threads_touched=threads_touched,
        done=phase == "done",
        progress_done=int(cursor.get("progress_done") or 0) + processed,
        progress_total=estimate,
        message=f"{phase}: wrote {processed} messages across {threads_touched} threads",
    )


def _fill_corpus_threads(pod: Any, account_id: str, my_email: str) -> tuple[int, int]:
    """Fetch whole conversations for corpus threads we only have part of.

    This is the one phase that writes documents, and the only one that fetches
    message bodies. Threads are fetched one at a time (Gmail has no batch thread
    read) but ingested together, so the datastore work is one batch, not eight.
    """
    pending = pod.query(
        "SELECT id, gmail_thread_id, subject FROM email_thread "
        "WHERE tier = 'corpus' AND corpus_filled IS NOT TRUE "
        f"ORDER BY last_message_at DESC LIMIT {THREADS_PER_CALL}"
    )
    rows = _rows(pending)
    if not rows:
        return 0, 0

    collected: list[dict] = []
    failures: list[dict] = []
    for thread in rows:
        try:
            result = _fetch(
                pod,
                account_id,
                "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
                {"user_id": "me", "thread_id": thread.get("gmail_thread_id")},
            )
            collected.extend(result.get("messages") or [])
        except Exception as exc:  # noqa: BLE001 — skip the thread, keep the backfill
            failures.append(
                {"id": thread["id"], "summary": f"fetch failed: {exc}"[:400]}
            )

    written = 0
    if collected:
        written, _ = _ingest(
            pod, collected, "corpus", my_email, write_document=True
        )

    # Classify while we hold the whole conversation. Roughly half of anything
    # `in:sent` turns up is not correspondence at all — notes to self, saved
    # drafts, automated sends with no recipient. Left alone they arrive in the
    # triage queue as hundreds of untitled rows, and they teach a drafting agent
    # nothing about how this person writes to another human, because there is no
    # other human in them.
    by_thread: dict[str, list[dict]] = {}
    for message in collected:
        by_thread.setdefault(message.get("threadId"), []).append(message)

    marks = []
    for thread in rows:
        mark = {"id": thread["id"], "corpus_filled": True}
        messages = by_thread.get(thread.get("gmail_thread_id")) or []
        if messages:
            others = {
                address
                for message in messages
                for address in _addresses(message.get("sender"))
                + _addresses(message.get("to"))
                if address != my_email
            }
            if not others:
                mark.update(
                    {
                        "tier": "index_only",
                        "state": "done",
                        "summary": "note to self — no other correspondent",
                    }
                )
        marks.append(mark)

    # Marked filled either way: a thread that cannot be fetched must not be
    # retried forever, or the backfill never reaches index_only.
    pod.records.bulk_update("email_thread", marks)
    if failures:
        pod.records.bulk_update("email_thread", failures)
    return written, len(rows)
