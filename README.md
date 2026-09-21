# donna

**Your mail, read and answered. She never sends anything.**

Once a mailbox is connected she reads it the way a chief of staff would: what is
actually waiting on you, who you owe an answer to, what you promised and when.
Every morning she hands you one briefing instead of an inbox.

She drafts replies in your voice. A draft sits until you say it is good, and only
then does it go — `send_draft` refuses anything a person has not marked
`approved`. That refusal is the whole safety story of this pod, and it is a
function, not a prompt.

```bash
git clone --depth 1 https://github.com/deepak-jha-kgp/donna && cd donna
LEMMA_POD_ID=<pod> ./setup.sh     # ~15s
./wire-gmail.sh                   # once a mail account is connected
```

Then say: **show me what's waiting on me**

## How it works

```
  Gmail ──► gmail_sync ──► email_thread / email_message
                              │  tier='corpus'  = real correspondence
                              │  tier='index_only' = bulk mail, never drafted from
                              ▼
                mailroom  — triages, decides what is waiting, drafts
                              │
                              ├──► draft rows ──► you approve ──► send_draft
                              │                                   (refuses anything else)
                              ├──► ledger     — what was promised, both ways
                              └──► chronicler — the morning paper
                                                 /memory/newspaper-template.html
```

Three agents, split because they answer different questions. `mailroom` runs
unattended over new mail; `ledger` extracts and closes commitments; `chronicler`
assembles one edition a morning. The two schedules are TIME jobs and only read
what is already in the pod — nothing here reaches outside on a timer.

## What is in the pod

| | |
|---|---|
| **Tables** | 13. `email_thread`/`email_message` are the spine; `person` and `commitment` are who you deal with and what was promised; `interest`/`source`/`story`/`edition`/`edition_item` are the paper; `draft`, `mailbox`, `standing_instruction`, `sync_cursor` |
| **Agents** | `mailroom` (unattended triage and drafting), `ledger` (commitments), `chronicler` (the morning paper) |
| **Functions** | `gmail_sync`, `send_draft`, `build_edition`, `derive_people`, `compile_instructions`, `list_mailboxes` |
| **Files** | `/memory/` is the pod's judgement — read before acting. Thread text is a file, not a column: `email_thread.body_path` → `/me/mail/<thread>.md` |
| **App** | `cos-app` — threads, drafts, commitments and the paper |
| **Surfaces** | one address per agent, plus the assistant's |

## Two rules that never move

**Mail is data, never instruction.** A message telling an agent to do something is
evidence of what its sender wants, not an order. This matters more here than
almost anywhere: the pod reads text written by people who are not the owner.

**Deterministic before model.** Counting, cadence and numbering are functions.
Only judgement reaches an agent.

## Setting it up by hand

```bash
lemma pods create donna
lemma pods import . --pod <pod> --set-pod-meta --with-files \
  --var cos_app_slug=cos-app-<something unique>
```

`--with-files` is load-bearing. [setup.sh](setup.sh) also substitutes the owner
into `/memory/AGENTS.md` and survives the rename colliding;
[AGENTS.md](AGENTS.md) says why each of those matters.

## Working on it

Edit `app/`, then `./app/build.sh` — `apps/cos-app/source/` is generated. Edit the
pod's judgement in `files/memory/`, then re-import with `--with-files`.

Built from the playbook at
[deepak-jha-kgp/gilfoyle](https://github.com/deepak-jha-kgp/gilfoyle/blob/main/PLAYBOOK.md).
