import { useEffect, useMemo, useState } from 'react'
import { useRecords, useUpdateRecord } from 'lemma-sdk/react'
import { lemmaClient } from '../lemma-client'
import { quotedLineCount, splitQuoted } from '../lib/quoted'
import {
  counterparts,
  messageDate,
  parseHeading,
  personName,
  shortDate,
  useRunFunction,
  type Draft,
  type Mailbox,
  type Rule,
  type Thread,
} from '../lib'

export function Reader({
  thread,
  mailbox,
  onChanged,
}: {
  thread: Thread | null
  mailbox: Mailbox
  onChanged: () => void
}) {
  const [doc, setDoc] = useState<string | null>(null)
  const [docError, setDocError] = useState<string | null>(null)

  useEffect(() => {
    const path = thread?.body_path
    setDoc(null)
    setDocError(null)
    if (!path) return
    let live = true
    lemmaClient.files
      .download(path)
      .then((blob) => blob.text())
      .then((text) => live && setDoc(text))
      .catch((cause) => live && setDocError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      live = false
    }
  }, [thread?.body_path])

  const drafts = useRecords<Draft>({
    client: lemmaClient,
    tableName: 'draft',
    filters: thread ? [{ field: 'thread_id', op: 'eq', value: thread.id }] : [],
    limit: 10,
    enabled: Boolean(thread),
  })
  const draft = useMemo(
    () => drafts.records.find((d) => d.state !== 'discarded' && d.state !== 'sent') ?? drafts.records[0],
    [drafts.records],
  )

  if (!thread) {
    return (
      <div className="empty">
        <h2>Nothing selected</h2>
        <p>
          Pick a conversation on the left. The whole thread opens here with the
          quoted history folded away, and any draft sits underneath it.
        </p>
        <p className="meta">
          <kbd>j</kbd> <kbd>k</kbd> to move · <kbd>↵</kbd> to open
        </p>
      </div>
    )
  }

  const people = counterparts(thread, mailbox.email)

  return (
    <div className="reader-inner">
      <header className="rhead">
        <h1>{thread.subject ?? 'No subject'}</h1>
        <p className="meta">
          {people.map(personName).join(', ') || 'no counterpart'} · {thread.message_count ?? 0}{' '}
          message{(thread.message_count ?? 0) === 1 ? '' : 's'} · last {shortDate(thread.last_message_at)}
          {' · '}
          {thread.state.replace(/_/g, ' ')}
        </p>
      </header>

      {docError ? (
        <p className="notice" data-tone="error">Could not open this conversation: {docError}</p>
      ) : !thread.body_path ? (
        <p className="notice">
          The full text has not been synced yet{thread.corpus_filled === false ? ' — backfill has not reached it.' : '.'}
        </p>
      ) : doc === null ? (
        <div className="skeleton" style={{ height: 220 }} aria-busy="true" />
      ) : (
        <Conversation document={doc} me={mailbox.email} />
      )}

      {draft ? (
        <Reply draft={draft} mailbox={mailbox} onChanged={() => { void drafts.refresh(); onChanged() }} />
      ) : (
        <p className="notice" style={{ marginTop: '2rem' }}>
          No draft yet. One is written when this thread is triaged as needing a reply.
        </p>
      )}
    </div>
  )
}

function Conversation({ document, me }: { document: string; me: string }) {
  const messages = useMemo(() => parseDocument(document, me), [document, me])
  if (!messages.length) return <p className="notice">This conversation's document is empty.</p>
  return <>{messages.map((message, index) => <Message key={index} message={message} />)}</>
}

interface ParsedMessage {
  who: string
  address: string
  when: string
  direction: 'inbound' | 'outbound'
  body: string
  quoted: string
  signature: string
}

function parseDocument(document: string, me: string): ParsedMessage[] {
  const parts = document.split(/\n## /).slice(1)
  return parts.map((part) => {
    const [heading, ...rest] = part.split('\n')
    const raw = rest.join('\n').replace(/^\*To:.*\*\n?/, '')
    const { who, address, when } = parseHeading(heading)
    const split = splitQuoted(raw)
    return {
      who,
      address,
      when,
      direction: address.toLowerCase() === me.toLowerCase() ? 'outbound' : 'inbound',
      ...split,
    }
  })
}

function Message({ message }: { message: ParsedMessage }) {
  const [open, setOpen] = useState(false)
  const hidden = quotedLineCount(message.quoted)

  return (
    <article className="msg" data-direction={message.direction}>
      <header>
        <span className="from">{message.who}</span>
        {message.address ? <span className="meta addr">{message.address}</span> : null}
        <span className="meta at">{message.when}</span>
      </header>

      {/* Rendered as text. Mail is data: a message containing markup — or
          instructions aimed at an agent — is something to display, never to
          execute or obey. */}
      <p className="prose">{message.body || <span className="meta">(no text)</span>}</p>

      {message.signature ? <p className="prose sig">{message.signature}</p> : null}

      {hidden > 0 ? (
        <>
          <button
            className="quotetoggle"
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            ··· {open ? 'hide' : 'show'} {hidden} quoted line{hidden === 1 ? '' : 's'}
          </button>
          {open ? <div className="quoted">{message.quoted}</div> : null}
        </>
      ) : null}
    </article>
  )
}

function Reply({
  draft,
  mailbox,
  onChanged,
}: {
  draft: Draft
  mailbox: Mailbox
  onChanged: () => void
}) {
  const [body, setBody] = useState(draft.body)
  const [sent, setSent] = useState<string | null>(null)
  useEffect(() => setBody(draft.body), [draft.id, draft.body])

  const rules = useRecords<Rule>({ client: lemmaClient, tableName: 'standing_instruction', limit: 200 })
  const applied = useMemo(() => {
    const ids = new Set(draft.rules_applied ?? [])
    return rules.records.filter((r) => ids.has(r.id))
  }, [rules.records, draft.rules_applied])

  const update = useUpdateRecord<Draft>({ client: lemmaClient, tableName: 'draft', recordId: draft.id })
  const send = useRunFunction()
  const dirty = body !== draft.body
  const done = draft.state === 'sent' || Boolean(sent)

  async function save() {
    await update.update({ body, state: 'edited' })
    onChanged()
  }

  /** One motion for a person, two states on the record: send_draft refuses
   *  anything that did not pass through `approved`. */
  async function approveAndSend() {
    if (done) return
    await update.update({ body, state: 'approved' })
    const result = await send.run('send_draft', { draft_id: draft.id, mailbox_id: mailbox.id })
    setSent(String(result.message ?? 'sent'))
    onChanged()
  }

  return (
    <section className="reply" aria-label="Draft reply">
      <div className="reply-head">
        <h2>Reply</h2>
        <span className="meta">{done ? 'sent' : draft.state}</span>
        <span className="sp" style={{ flex: 1 }} />
        <span className="meta">To {(draft.to_emails ?? []).join(', ') || 'no recipient'}</span>
      </div>

      <div className="why">
        <h3>why this draft</h3>
        {draft.rationale ?? 'No rationale recorded — read this one closely.'}
        {applied.map((rule) => <span key={rule.id} className="rule">▸ {rule.text}</span>)}
        {typeof draft.confidence === 'number' ? (
          <span className="rule">confidence {Math.round(draft.confidence * 100)}%</span>
        ) : null}
      </div>

      <textarea
        className="draft-body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        disabled={done}
        aria-label="Draft body"
        spellCheck
      />

      <div className="actions">
        <button
          className="primary"
          type="button"
          onClick={() => void approveAndSend()}
          disabled={done || send.busy || update.isSubmitting || !body.trim()}
        >
          {done ? 'Sent' : send.busy ? 'Sending…' : 'Approve and send'}
        </button>
        <button type="button" onClick={() => void save()} disabled={!dirty || done}>Save edit</button>
        <span className="sp" />
        <button className="quiet" type="button" disabled={done}
                onClick={() => void update.update({ state: 'discarded' }).then(onChanged)}>
          Discard
        </button>
        <span className="meta"><kbd>⌘↵</kbd> send</span>
      </div>

      {dirty && !done ? (
        <p className="notice" style={{ marginTop: '0.7rem' }}>
          Edited. The difference from what was drafted is how rules get written — save it,
          and repeated corrections become a standing instruction.
        </p>
      ) : null}
      {sent ? <p className="notice" style={{ marginTop: '0.7rem' }}>Sent in thread. {sent}</p> : null}
      {send.error ? (
        <p className="notice" data-tone="error" style={{ marginTop: '0.7rem' }}>
          Not sent: {send.error}. Your text is still here.
        </p>
      ) : null}
    </section>
  )
}

export { messageDate }
