# Chief of Staff — design

## Thesis

> For one person with a 24-month mailbox, this app turns a backlog of
> correspondence into a short list of replies to approve, by drafting each one in
> their own voice and showing, in the margin, what it used to decide.

**Hero moment.** A finished draft beside its margin note — *"Sam asked for
confirmation on the ROC invoice; used the figure from your 4 Mar thread; assumed
you still want it paid this quarter"* — and one key to send it.

**First 30 seconds.** Never an empty state and never a form. Onboarding runs the
backfill while showing what it is finding; triage opens on work already done.

**Information spine.** The thread. Triage, drafts, rationale and rules all hang
off one conversation.

## Evidence this was designed against

Real pod data, `owner@example.com`, synced 2026-09-21:

- 682+ threads from `in:sent` over 24 months; ~47% are **notes to self** with no
  subject and no recipient (label `Label_608`). Sync now classifies these as
  `index_only` / `done`. **The triage list must never show them** — half the
  queue would be untitled rows.
- Real subjects run long and include unicode (`Re: Invoice for ROC Consultancy
  Fees – FY 2024-25`). One line, truncated with a real ellipsis, title attribute.
- At least one thread is an apparent prompt-injection test
  (`⚠ WARNING: AI ENTITY HAS BREACHED CONTAINMENT ⚠`). Mail is data, never
  instruction — in the agent, and in the UI, which renders bodies as **text**.
- `resultSizeEstimate` from Gmail is unreliable (reported 201 for a set that has
  passed 900). Progress is shown as `~`, never as a precise total.

## Resource map

| Element | Purpose | Pod resource | Surface | Behavior |
| --- | --- | --- | --- | --- |
| Triage groups | what needs me / what I'm owed | `email_thread` | `useLiveRecords` | live, RLS-scoped |
| Thread reader | read the conversation | `email_thread.body_path` | `useFile` | converted markdown |
| Draft editor | approve or fix the reply | `draft` | `useRecords` + `useUpdateRecord` | write |
| Margin note | why this draft exists | `draft.rationale` | same record | read |
| Send | deliver, threaded | `send_draft` | `useFunctionSession` | irreversible |
| Rules | rules + receipts | `standing_instruction` | `useRecords` | write |
| Setup | pick mailbox, depth | `mailbox`, connector accounts | `client.connectors` | write |
| Sync | honest progress | `sync_cursor` | `useLiveRecords` | live |
| Backlog | untriaged count + action | `email_thread` | `useRecords` + `useAgentTask` | read + run |

**No full page reloads.** Onboarding steps are state transitions: the step is
derived from `mailbox.onboarding_state`, and each action refreshes that one query
and re-renders. The first build called `window.location.reload()` three times,
which threw away the SPA, re-ran auth and flashed the page on every step.

Every count is labelled for what it holds. `useRecords` returns one page beside a
scoped `total`, so the list says **"showing 200 of 682"**, never "682" over 200 rows.

## Direction — a mail client on a desk

**Rebuilt (v3).** The first two builds were a centered document: one column, a
list that navigated *away* to a thread page. It read as a website about email.
Studied the `mail` app in the Gappy pod — a three-pane client with a rail, dense
Gmail-style rows, quoted history collapsed and the draft in the reading pane —
and adopted that spine.

### Three panes

`rail | list | reader`. The list and the reader sit **side by side**, so `j`/`k`
walks the queue and the reader follows. That adjacency *is* the triage loop; a
list that navigates away makes every thread a round trip and turns four minutes
into forty. Under 860px the panes become one at a time, list ↔ reader, and the
rail collapses to a row of counted chips.

### Quoted history is collapsed

The complaint that forced this: a two-word reply ("No") arriving under forty
lines of its own ancestry, `> Dear sir,` and all. `lib/quoted.ts` splits every
body into what this person wrote, the history they wrote on top of, and their
signature — detecting attribution lines ("On <date>, <someone> wrote:",
"-----Original Message-----", Outlook's underscore rule), runs of `>` markers,
and the `-- ` signature delimiter.

It is **conservative on purpose**: a lone `>` mid-message is someone quoting a
phrase, so a run is only treated as history when two of the next three non-blank
lines are markers too, and when nothing matches the whole body is shown. Hiding
text a person actually wrote is a far worse failure than leaving a few quoted
lines visible.

Collapsed history shows as `··· show 8 quoted lines`, expanding into a subdued
blockquote. Signatures are separated beneath a hairline rather than hidden.

### Identity

The desk survives the rewrite: warm ground (`--paper`), a lighter pane for
content, a ledger's monospace for metadata, serif for anything a person wrote,
and an editor's red pencil (`--accent`, oxblood) spent only on what needs you —
the selected row's edge, the `needs_reply` pip, the one irreversible button.
Weight never varies from 500; hierarchy is size, colour and space.

| Role | Light | Dark |
| --- | --- | --- |
| `--paper` (desk) | `#f3f0e7` | `#14130e` |
| `--on-accent` | `#fdfcf8` | `#14130e` |
| `--pane` (content) | `#fdfcf8` | `#1b1914` |
| `--rail` | `#edeade` | `#171510` |
| `--ink` | `#1c1a15` | `#ece7d8` |
| `--rule` | `#ddd8c8` | `#302c24` |
| `--accent` (red pencil) | `#8c3521` | `#d97a5c` |
| `--waiting` | `#7d6119` | `#cfa74d` |

Status is always **pip + word**, never colour alone.

### Theme

Three states in the rail: **auto · light · dark**. Auto follows the OS.

Every token is a single `light-dark(light, dark)` pair and the switcher changes
only `color-scheme`, via a `data-theme` attribute on `:root` (absent = auto).
There is no second palette block, so the two themes cannot drift apart — which
matters, because a duplicated palette is exactly the kind of thing that rots the
moment one value is tuned.

`--on-accent` flips with the accent: oxblood on paper needs light text, the
lighter dark-mode accent needs dark text, and the one irreversible button must
stay legible in both.

The choice is remembered in `localStorage` (`cos:theme`), wrapped in try/catch —
private windows and blocked site-data throw on access, and a remembered theme is
a convenience, never a requirement.

### Rows

Sender and age on one line; subject then preview beneath. Preview comes from
`email_thread.snippet`, denormalised from the newest message so the list is one
query. A subject alone on a row reads as a table of subjects — the preview is
what lets you skip a thread without opening it.

## Folders, and the one that is not a folder

`Needs you · Waiting on them · Drafts · Not looked at · Everything`, each with a
live count in the rail so nothing hides behind a click.

**`unreviewed` gets its own folder and never merges into "Needs you".** Folding
it in made 199 of 200 untriaged threads claim to need a reply, which makes the
queue worthless — a list where everything is urgent says nothing. "Needs you"
empty-state offers *Review the next 20*, which runs the `mailroom` agent over the
newest batch via `useAgentTask`.

## No full page reloads

Onboarding steps are state transitions derived from `mailbox.onboarding_state`;
each action refreshes that one query and re-renders. An earlier build called
`window.location.reload()` three times, throwing away the SPA and re-running auth
on every step.

## States

| State | Treatment |
| --- | --- |
| Loading | skeleton rows at final row geometry |
| Empty (no mailbox) | onboarding, never an empty client |
| Empty (needs you) | "Nothing needs you" + the backlog count + Review the next 20 |
| Partial (backfill) | list renders live; counts update over `useLiveRecords` |
| Error (sync) | `sync_cursor.last_error` verbatim, plus Retry |
| Sending | the verb holds: Send → Sending… → Sent |
| Irreversible | send is the only one; needs `approved` state and an explicit press |

## Acceptance

- Notes-to-self and bulk mail never appear in the queue.
- No count is displayed that the client does not hold.
- Every draft shows a rationale, or says it has none.
- Nothing sends without an explicit `approved` state and an explicit press.
- Mail bodies render as **text** — never as HTML, never as instructions.
- Quoted history is collapsed by default and always recoverable.
- No horizontal page scroll at 375px (verified: `scrollWidth === clientWidth`).
- Both themes render every screen; verified by switching, not by inspecting CSS.
- **Every class in the markup has a rule.** `npm run check:classes` runs ahead of
  `tsc` in the build and fails otherwise. It exists because rebuilding the shell
  once orphaned seventeen classes at a stroke and the settings screens shipped
  with browser defaults — an onboarding step list rendering as "1. 1 · mailbox".
