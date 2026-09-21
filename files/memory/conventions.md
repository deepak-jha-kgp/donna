# Conventions, and the traps

Things that cost a day to learn. Read before changing sync, grants or the app.

## Tiers: what is correspondence

`email_thread.tier` decides whether a thread is real:

- **`corpus`** — you took part, or Gmail filed it `CATEGORY_PERSONAL`. Body text
  is synced to `/me/mail/<thread>.md` and indexed.
- **`index_only`** — everything else. Metadata only, never a document, never a
  draft. Roughly half of any mailbox.

Two rules that took real data to find:

1. **Roughly 47% of `in:sent` is not correspondence** — notes to self with no
   subject and no recipient. Classified out during `corpus_fill`. Left in, half
   the triage queue is untitled rows.
2. **Your having replied outranks Gmail's category.** A real broker thread —
   "Re: Group health insurance" — was filed `CATEGORY_UPDATES`. Bulk categories
   demote; an outbound message from you always promotes.

## Triage states

`unreviewed → needs_reply | waiting_on_them | done | ignored`

**`unreviewed` is not `needs_reply`.** Folding them together made 199 of 200
untriaged threads claim to need a reply, which makes the queue worthless. It has
its own folder.

## Grants

- **`/me` cannot be granted and does not need to be.** Bundle import *and*
  `permissions add` both reject a grant on a PERSONAL folder. It is the invoking
  user's own tree, reached by delegation. Verified: `gmail_sync` writes
  `/me/mail/*.md` with no folder grant at all.
- `read` expands to `datastore.table.read` **plus** `datastore.record.read`.
  Writing only the table permission by hand 403s at runtime.
- A grant is a ceiling on the workload, not a promotion for the person.

## The function sandbox

Minimal, and **`#python_packages` does not work on this deployment** — it fails
with `Function dependency builder is not installed`, whatever the builder docs
say. Functions get stdlib, `httpx`, `pydantic`, `lemma-sdk`. No Pillow, no
browser. Anything needing a browser or an image library belongs in an agent with
`WORKSPACE_CLI`.

## Batching

One page of mail is ~40 round trips if you write per row, which blows the request
timeout. Everything in `gmail_sync` is batched: one read, one bulk create, one
bulk update, one read back. Keep `max_pages` small — `corpus_fill` runs ~22s for
8 threads.

## Numbers you must not trust

- Gmail's `resultSizeEstimate` lies — it reported 201 for a set past 1,300. Never
  render it as a total.
- `records.list` returns one page beside a scoped `total`. Show "200 of 802",
  never "802" over 200 rows.

## The approval seam

Two independent reasons nothing goes out on its own: `send_draft` refuses
anything not `approved`, and no agent holds a connector grant that can send.
Keep both.
