#input_type_name: SendDraftInput
#output_type_name: SendDraftResult
#function_name: send_draft

"""Send an approved draft as a reply, in its own thread.

GMAIL_SEND_EMAIL is deliberately NOT used here. It has no thread_id and no
In-Reply-To, so a reply sent through it starts a new conversation: the recipient
sees an orphan message, and your own thread loses the answer. GMAIL_REPLY_TO_THREAD
takes the thread and keeps the subject, which is what a reply is.

Nothing here decides to send. The caller has to pass a draft that a human moved
to `approved`, and a draft already `sent` is refused rather than sent twice.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

AUTH_CONFIG = "gmail"


class SendDraftInput(BaseModel):
    draft_id: str
    # The caller states the mailbox so the send cannot silently go out from a
    # different connected account than the one the thread belongs to.
    mailbox_id: str


class SendDraftResult(BaseModel):
    sent: bool
    draft_id: str
    gmail_message_id: str | None = None
    message: str


def _result(response: Any) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    result = (payload or {}).get("result", payload) or {}
    if isinstance(result, dict) and isinstance(result.get("data"), dict):
        merged = dict(result["data"])
        merged.update({k: v for k, v in result.items() if k != "data"})
        return merged
    return result if isinstance(result, dict) else {}


def send_draft(ctx: FunctionContext, data: SendDraftInput) -> SendDraftResult:
    pod = ctx.pod
    drafts = pod.table("draft")
    draft = drafts.get(data.draft_id)

    if draft.get("state") == "sent":
        return SendDraftResult(
            sent=False,
            draft_id=data.draft_id,
            gmail_message_id=draft.get("sent_gmail_message_id"),
            message="already sent — refusing to send twice",
        )
    if draft.get("state") != "approved":
        return SendDraftResult(
            sent=False,
            draft_id=data.draft_id,
            message=(
                f"draft is '{draft.get('state')}', not 'approved'. "
                "A person approves; this function only delivers."
            ),
        )

    thread = pod.table("email_thread").get(draft["thread_id"])
    mailbox = pod.table("mailbox").get(data.mailbox_id)

    recipients = list(draft.get("to_emails") or [])
    if not recipients:
        return SendDraftResult(
            sent=False, draft_id=data.draft_id, message="draft has no recipient"
        )

    payload: dict[str, Any] = {
        "user_id": "me",
        "thread_id": thread["gmail_thread_id"],
        "recipient_email": recipients[0],
        "message_body": draft["body"],
        "is_html": False,
    }
    extra = recipients[1:]
    if extra:
        payload["cc"] = extra
    if draft.get("cc_emails"):
        payload["cc"] = list(payload.get("cc", [])) + list(draft["cc_emails"])

    response = _result(
        pod.connectors.execute(
            AUTH_CONFIG,
            "GMAIL_REPLY_TO_THREAD",
            payload,
            account_id=mailbox["account_id"],
        )
    )
    gmail_message_id = response.get("id") or response.get("messageId")
    now = datetime.now(timezone.utc).isoformat()

    drafts.update(
        data.draft_id,
        {
            "state": "sent",
            "sent_at": now,
            "sent_gmail_message_id": gmail_message_id,
        },
    )
    # The ball is theirs now. This is what makes "waiting on them" real rather
    # than a thing you have to remember.
    pod.table("email_thread").update(
        draft["thread_id"],
        {
            "state": "waiting_on_them",
            "waiting_since": now,
            "last_direction": "outbound",
            # The thread gained a message we did not sync; let corpus_fill
            # rebuild its document rather than leaving the file one reply stale.
            "corpus_filled": False,
        },
    )

    # Credit the rules that shaped this send. An instruction with no receipts is
    # one you have no reason to keep.
    for rule_id in draft.get("rules_applied") or []:
        try:
            rule = pod.table("standing_instruction").get(rule_id)
            pod.table("standing_instruction").update(
                rule_id,
                {
                    "applied_count": int(rule.get("applied_count") or 0) + 1,
                    "last_applied_at": now,
                },
            )
        except Exception:  # noqa: BLE001 — a missing rule must not fail a sent mail
            continue

    return SendDraftResult(
        sent=True,
        draft_id=data.draft_id,
        gmail_message_id=gmail_message_id,
        message=f"replied in thread {thread['gmail_thread_id']}",
    )
