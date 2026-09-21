# Pod map

Every resource, what it is for, and who writes it. Loaded on demand — the pod
index at `/memory/AGENTS.md` is capped and only carries pointers.

## Tables

| Table | What it holds | Written by |
| --- | --- | --- |
| `mailbox` | which account this person's chief of staff works on, backfill depth, onboarding state | the app |
| `email_thread` | one conversation; triage `state`, `tier`, `snippet`, `body_path` | `gmail_sync`, `mailroom` |
| `email_message` | one message; metadata only — bodies live in the thread document | `gmail_sync` |
| `draft` | a reply not yet sent, with `rationale` and `rules_applied` | `mailroom` |
| `standing_instruction` | the owner's rules, one sentence per row, with receipts | `mailroom` proposes, the app activates |
| `sync_cursor` | resumable sync state; `phase` drives the backfill machine | `gmail_sync` |
| `person` | who they deal with, cadence, who has gone quiet | `derive_people` |
| `commitment` | what was promised, either direction, with the sentence that made it | `ledger` |
| `interest` | topics derived from their own mail, then confirmed | `chronicler` proposes |
| `source` | where the sweep looks | `chronicler` |
| `story` | candidates, deduped by `fingerprint` | `chronicler` |
| `edition` / `edition_item` | one morning's paper; `ordinal` makes items addressable | `build_edition` |

All tables are RLS-on: rows belong to the person who made them.

## Functions — deterministic only

- **`gmail_sync`** — backfill *and* live sync on one code path, `phase` on the
  cursor. Bounded per call; the caller loops until `done`.
- **`send_draft`** — the only send path. Refuses anything not `approved`, refuses
  to send twice, threads via `GMAIL_REPLY_TO_THREAD`.
- **`compile_instructions`** — `standing_instruction` rows → `/me/cos/*.md` and
  the `/me/AGENTS.md` preamble. One direction, table to files.
- **`list_mailboxes`** — connected accounts for onboarding; keeps the org id
  server-side.
- **`derive_people`** — counts, last touch, cadence, who is overdue. No model.
- **`build_edition`** — assembles and **numbers** the paper.

## Agents — judgement only

- **`mailroom`** — triages threads, writes drafts, proposes rules. Unattended.
- **`ledger`** — extracts and closes commitments from real correspondence.
- **`chronicler`** — sweeps the web against confirmed interests, assembles the
  edition, renders the PDF (`WORKSPACE_CLI` — the only place a browser exists),
  and attaches it.

## Schedules

- **`nightly-ledger`** — 01:00 Asia/Kolkata → `ledger`. Closes settled
  commitments before extracting new ones, so the morning edition reads a current
  ledger.
- **`morning-paper`** — 06:30 Asia/Kolkata → `chronicler`.

A `TIME` schedule runs as its configured user, so these are one row per person.
There is no timezone flag; it is merged through `config`.

## Files

- `/me/mail/<thread>.md` — the conversation, one document per thread. This is
  the retrieval unit; it is what the embedder sees.
- `/me/cos/*.md` — compiled rules, per scope.
- `/me/briefings/<date>.pdf` and `.html` — the paper.
- `/memory/newspaper-template.html` — the paper's design. Edit this, not the
  agent, to change how it looks.

## Surfaces

Two Resend mailboxes, auto-provisioned: `resend-mailroom`, `resend-assistant`.
The paper attaches to a reply there. WhatsApp or Telegram would each need a
surface created first.