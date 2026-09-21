#input_type_name: ListMailboxesInput
#output_type_name: ListMailboxesResult
#function_name: list_mailboxes

"""The mailboxes onboarding can offer, without the browser holding an org id.

`connectors.accounts.list` is an ORGANIZATION-scoped call and the browser client
is pod-scoped — it has a podId and no orgId. Rather than teaching the app an org
id it has no business knowing, the lookup happens here, where the binding already
exists, and the app gets back exactly the three fields the picker renders.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class ListMailboxesInput(BaseModel):
    provider: str = "gmail"


class Candidate(BaseModel):
    account_id: str
    email: str
    status: str
    already_used: bool


class ListMailboxesResult(BaseModel):
    candidates: list[Candidate]
    message: str


def _items(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    if isinstance(payload, list):
        return [p for p in payload if isinstance(p, dict)]
    return [p for p in (payload or {}).get("items", []) if isinstance(p, dict)]


def list_mailboxes(
    ctx: FunctionContext, data: ListMailboxesInput
) -> ListMailboxesResult:
    pod = ctx.pod

    taken = {
        row.get("account_id")
        for row in _items(pod.table("mailbox").list(limit=50))
        if row.get("account_id")
    }

    accounts = _items(pod.connectors.accounts.list(app=data.provider, limit=50))
    candidates = [
        Candidate(
            account_id=str(account.get("id")),
            email=str(
                account.get("email")
                or account.get("display_name")
                or account.get("id")
            ),
            status=str(account.get("status") or "UNKNOWN"),
            already_used=account.get("id") in taken,
        )
        for account in accounts
        if account.get("id")
    ]

    connected = [c for c in candidates if c.status == "CONNECTED"]
    return ListMailboxesResult(
        candidates=connected or candidates,
        message=(
            f"{len(connected)} connected {data.provider} account(s)"
            if connected
            else f"no connected {data.provider} account — connect one first"
        ),
    )
