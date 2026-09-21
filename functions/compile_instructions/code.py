#input_type_name: CompileInstructionsInput
#output_type_name: CompileInstructionsResult
#function_name: compile_instructions

"""Compile the standing_instruction table down to files the agents actually read.

The table is the source of truth, because a rule needs a lifecycle (proposed ->
active -> retired), provenance, and a count of what it changed — none of which a
markdown file can hold. But an agent reads files, and /me/AGENTS.md is spliced
into every run automatically. So: one direction, table -> files, recompiled on
every change.

The budget is the whole reason this is a function rather than a string
concatenation. /me/AGENTS.md is capped at 2000 characters per scope before the
runtime truncates it at a line boundary — silently, from the bottom. So AGENTS.md
gets a short preamble plus pointers, and the bulk of each scope's rules lives in
/me/cos/<scope>.md, which the agent opens when it needs it. Rules that would
overflow the preamble are reported, not quietly dropped.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

COS_ROOT = "/me/cos"
# The runtime's own per-scope cap (agent_memory_index_max_chars). Left with
# headroom: going over does not error, it truncates the tail without telling you.
AGENTS_MD_BUDGET = 1600

SCOPES = ["general", "drafting", "triage", "briefing", "crm"]


class CompileInstructionsInput(BaseModel):
    # Present so a caller can compile after a specific edit; unused otherwise.
    reason: str = "manual"


class CompileInstructionsResult(BaseModel):
    active_rules: int
    files_written: list[str]
    preamble_chars: int
    over_budget: bool
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def compile_instructions(
    ctx: FunctionContext, data: CompileInstructionsInput
) -> CompileInstructionsResult:
    pod = ctx.pod
    active = _rows(
        pod.query(
            "SELECT id, scope, text, applied_count FROM standing_instruction "
            "WHERE state = 'active' ORDER BY applied_count DESC, created_at ASC"
        )
    )

    by_scope: dict[str, list[dict]] = {scope: [] for scope in SCOPES}
    for rule in active:
        by_scope.setdefault(rule.get("scope") or "general", []).append(rule)

    written: list[str] = []
    for scope, rules in by_scope.items():
        if scope == "general":
            continue
        lines = [f"# Standing instructions — {scope}", ""]
        if rules:
            lines += [f"- {r['text']}" for r in rules]
        else:
            lines.append("*(none yet — they are written as you correct drafts.)*")
        path = f"{COS_ROOT}/{scope}.md"
        pod.files.write_text(path, "\n".join(lines) + "\n")
        written.append(path)

    # The preamble: only `general` rules ride in the auto-injected file, plus
    # pointers to everything else. Ordered by applied_count, so if the cap ever
    # does bite, what falls off the bottom is what has earned the least.
    preamble = ["# Chief of staff", ""]
    general = by_scope.get("general") or []
    if general:
        preamble += [f"- {r['text']}" for r in general] + [""]
    preamble.append("Rules for a specific job live in files — read the one you need:")
    preamble += [
        f"- `{COS_ROOT}/{scope}.md` — {len(by_scope.get(scope) or [])} rule(s)"
        for scope in SCOPES
        if scope != "general"
    ]
    body = "\n".join(preamble) + "\n"

    over_budget = len(body) > AGENTS_MD_BUDGET
    if over_budget:
        # Say so rather than letting the runtime shear the tail off in silence.
        body = (
            body[:AGENTS_MD_BUDGET].rsplit("\n", 1)[0]
            + "\n\n*(over budget — retire a rule; the rest was cut here.)*\n"
        )
    pod.files.write_text("/me/AGENTS.md", body)
    written.append("/me/AGENTS.md")

    return CompileInstructionsResult(
        active_rules=len(active),
        files_written=written,
        preamble_chars=len(body),
        over_budget=over_budget,
        message=(
            f"compiled {len(active)} active rule(s) into {len(written)} file(s)"
            + (" — preamble over budget" if over_budget else "")
        ),
    )
