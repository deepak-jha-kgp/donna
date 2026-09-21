import { useEffect, useMemo, useState } from 'react'
import { useLiveRecords, useRecords } from 'lemma-sdk/react'
import { lemmaClient } from '../lemma-client'
import {
  go,
  shortDate,
  useRunFunction,
  type Cursor,
  type Mailbox,
  type Thread,
} from '../lib'

type Account = { account_id: string; email: string; status: string; already_used: boolean }

const DEPTHS = [
  {
    months: 12,
    title: 'The last year',
    why: 'Fastest. Enough for live relationships, thin on how you write.',
  },
  {
    months: 24,
    title: 'The last two years',
    why: 'The default. Recent enough that it learns how you write now, not in 2021.',
  },
  {
    months: 120,
    title: 'Everything',
    why: 'Slowest, and the oldest mail teaches a voice you have since grown out of.',
  },
]

export function Setup({
  mailbox,
  onChanged,
  previewStep,
}: {
  mailbox: Mailbox | null
  onChanged: () => void
  previewStep?: 'connect' | 'configure' | 'backfilling' | 'ready'
}) {
  const step = previewStep ?? (!mailbox ? 'connect' : mailbox.onboarding_state)

  return (
    <div className="column narrow">
      <ol className="steps">
        <li data-state={step === 'connect' ? 'current' : 'done'}>1 · mailbox</li>
        <li data-state={step === 'configure' ? 'current' : step === 'connect' ? 'todo' : 'done'}>
          2 · how far back
        </li>
        <li data-state={step === 'backfilling' ? 'current' : step === 'ready' ? 'done' : 'todo'}>
          3 · reading it
        </li>
      </ol>

      {step === 'connect' ? <PickMailbox onChanged={onChanged} /> : null}
      {step === 'configure' && mailbox ? <PickDepth mailbox={mailbox} onChanged={onChanged} /> : null}
      {(step === 'backfilling' || step === 'ready') && mailbox ? (
        <Reading mailbox={mailbox} onChanged={onChanged} preview={Boolean(previewStep)} />
      ) : null}
    </div>
  )
}

/** Step 1. Zero typing: the accounts already connected to this org are listed,
 *  and one of them is a tap away. */
function PickMailbox({ onChanged }: { onChanged: () => void }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [note, setNote] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)
  const list = useRunFunction()
  const create = useRunFunction()

  useEffect(() => {
    let live = true
    list
      .run('list_mailboxes', { provider: 'gmail' })
      .then((result) => {
        if (!live) return
        setAccounts((result.candidates as Account[]) ?? [])
        setNote(String(result.message ?? ''))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
    // Once, on mount: the account list does not change while this screen is open.
  }, [])

  async function choose(account: Account) {
    setBusy(account.account_id)
    try {
      await lemmaClient.records.create('mailbox', {
        account_id: account.account_id,
        email: account.email,
        provider: 'gmail',
        is_active: true,
        backfill_months: 24,
        onboarding_state: 'configure',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        connected_at: new Date().toISOString(),
      })
      onChanged()
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause))
      setBusy(null)
    }
  }

  return (
    <>
      <h1>Which mailbox?</h1>
      <p className="meta" style={{ margin: '0.35rem 0 1.5rem' }}>
        Your chief of staff reads this mailbox and drafts replies from it. It never sends
        anything without you.
      </p>

      {list.error ? (
        <p className="notice" data-tone="error">
          Could not list your connected accounts: {list.error}
        </p>
      ) : null}

      {accounts === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : accounts.length === 0 ? (
        <div className="empty">
          <p>No Gmail account is connected to this organization yet.</p>
          <p className="meta">
            Connect one from the pod's connector settings, then reload — this page lists
            whatever is connected.
          </p>
        </div>
      ) : (
        accounts.map((account) => (
          <button
            key={account.account_id}
            className="choice"
            type="button"
            onClick={() => void choose(account)}
            disabled={busy !== null || account.already_used}
          >
            {account.email}
            <span className="why">
              {account.already_used
                ? 'Already set up in this pod'
                : busy === account.account_id
                  ? 'Setting up…'
                  : 'Connected · Gmail'}
            </span>
          </button>
        ))
      )}
      {note && accounts?.length ? <p className="meta">{note}</p> : null}
    </>
  )
}

/** Step 2. Three cards, the middle one already chosen, each with its reason. */
function PickDepth({ mailbox, onChanged }: { mailbox: Mailbox; onChanged: () => void }) {
  const [months, setMonths] = useState(mailbox.backfill_months ?? 24)
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    await lemmaClient.records.update('mailbox', mailbox.id, {
      backfill_months: months,
      onboarding_state: 'backfilling',
    })
    onChanged()
    setBusy(false)
  }

  return (
    <>
      <h1>How far back should it read?</h1>
      <p className="meta" style={{ margin: '0.35rem 0 1.5rem' }}>
        Only conversations you took part in are read in full. Everything else —
        newsletters, receipts, notifications — is counted, never indexed.
      </p>

      {DEPTHS.map((depth) => (
        <button
          key={depth.months}
          className="choice"
          type="button"
          aria-pressed={months === depth.months}
          onClick={() => setMonths(depth.months)}
        >
          {depth.title}
          <span className="why">{depth.why}</span>
        </button>
      ))}

      <button className="primary" type="button" onClick={() => void start()} disabled={busy} style={{ marginTop: '1rem' }}>
        {busy ? 'Starting…' : 'Start reading'}
      </button>
    </>
  )
}

/** Step 3. The wait is the demo. Real findings count up while the backfill runs,
 *  and the subjects landing right now scroll past underneath — because a
 *  progress bar with nothing behind it is indistinguishable from a hang. */
function Reading({
  mailbox,
  onChanged,
  preview,
}: {
  mailbox: Mailbox
  onChanged: () => void
  preview?: boolean
}) {
  const threads = useLiveRecords<Thread>({
    client: lemmaClient,
    tableName: 'email_thread',
    sort: [{ field: 'created_at', direction: 'desc' }],
    limit: 200,
    reconcile: 'refetch',
    enabled: !preview,
  })
  const cursors = useLiveRecords<Cursor>({
    client: lemmaClient,
    tableName: 'sync_cursor',
    limit: 10,
    reconcile: 'refetch',
    enabled: !preview,
  })
  const messages = useRecords({ client: lemmaClient, tableName: 'email_message', limit: 1, enabled: !preview })
  const sync = useRunFunction()

  const backfill = cursors.records.find((c) => c.kind === 'gmail_backfill')
  const done = backfill?.phase === 'done' || mailbox.onboarding_state === 'ready'

  const people = useMemo(() => {
    const seen = new Set<string>()
    for (const thread of threads.records) {
      for (const address of thread.participants ?? []) {
        if (address.toLowerCase() !== mailbox.email.toLowerCase()) seen.add(address)
      }
    }
    return seen.size
  }, [threads.records, mailbox.email])

  const recent = threads.records.filter((t) => t.subject).slice(0, 6)
  const correspondence = threads.records.filter((t) => t.tier === 'corpus').length

  async function finish() {
    await lemmaClient.records.update('mailbox', mailbox.id, { onboarding_state: 'ready' })
    onChanged()
    go('/')
  }

  return (
    <>
      <h1>{done ? 'Ready.' : 'Reading your mail.'}</h1>
      <p className="meta" style={{ margin: '0.35rem 0 1rem' }}>
        {mailbox.email} · {backfill?.phase?.replace(/_/g, ' ') ?? 'starting'}
        {backfill?.last_run_at ? ` · last ${shortDate(backfill.last_run_at)}` : ''}
      </p>

      <div className="progress" aria-hidden="true">
        <i style={{ width: done ? '100%' : phaseWidth(backfill?.phase) }} />
      </div>

      <div className="findings">
        <div className="finding">
          {/* Counts of what the client actually holds — a page size rendered as a
              total is a wrong number exactly where trust is being formed. */}
          <span className="n">{messages.total.toLocaleString()}</span>
          <span className="label">messages</span>
        </div>
        <div className="finding">
          <span className="n">{threads.total.toLocaleString()}</span>
          <span className="label">conversations</span>
        </div>
        <div className="finding">
          <span className="n">{people.toLocaleString()}</span>
          <span className="label">people <span style={{ opacity: 0.6 }}>(in last {threads.records.length})</span></span>
        </div>
        <div className="finding">
          <span className="n">{correspondence.toLocaleString()}</span>
          <span className="label">worth reading</span>
        </div>
      </div>

      {recent.length > 0 ? (
        <ul className="ticker" aria-label="Recently read">
          {recent.map((thread) => (
            <li key={thread.id}>{thread.subject}</li>
          ))}
        </ul>
      ) : null}

      {backfill?.last_error ? (
        <p className="notice" data-tone="error" style={{ marginTop: '1rem' }}>
          Sync stopped: {backfill.last_error}
        </p>
      ) : null}

      <div className="draft-actions" style={{ marginTop: '1.5rem' }}>
        <button
          className="primary"
          type="button"
          onClick={() => (done ? void finish() : void sync.run('gmail_sync', {
            mailbox_id: mailbox.id,
            mode: 'backfill',
            max_pages: 1,
          }).then(() => { void threads.refresh(); void cursors.refresh() }))}
          disabled={sync.busy}
        >
          {done ? 'Open triage' : sync.busy ? 'Reading…' : 'Read another batch'}
        </button>
        {!done ? (
          <button className="quiet" type="button" onClick={() => void finish()}>
            Skip ahead to triage
          </button>
        ) : null}
      </div>

      {!done ? (
        <p className="notice" style={{ marginTop: '1rem' }}>
          You do not have to wait. Triage works on what has landed so far, and the rest
          keeps arriving behind you.
        </p>
      ) : null}

      {sync.error ? (
        <p className="notice" data-tone="error" style={{ marginTop: '0.75rem' }}>
          {sync.error}
        </p>
      ) : null}
    </>
  )
}

function phaseWidth(phase: string | null | undefined) {
  switch (phase) {
    case 'corpus_sent':
      return '25%'
    case 'corpus_fill':
      return '60%'
    case 'index_only':
      return '85%'
    case 'done':
      return '100%'
    default:
      return '8%'
  }
}
