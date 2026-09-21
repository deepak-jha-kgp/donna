import { useEffect, useMemo, useState } from 'react'
import { useAgentTask, useLiveRecords, useRecords } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'
import { Rail } from './panes/Rail'
import { ThreadList } from './panes/ThreadList'
import { Reader } from './panes/Reader'
import { Paper } from './panes/Paper'
import { ListHead, TITLES } from './panes/ListHead'
import { Rules } from './pages/Rules'
import { Setup } from './pages/Setup'
import { useKeys, type Draft, type Folder, type Mailbox, type Thread } from './lib'

const REVIEW_BATCH = 20

const REVIEW_INSTRUCTION =
  `Take the ${REVIEW_BATCH} newest email_thread rows where tier='corpus' AND ` +
  "state='unreviewed' AND corpus_filled=true, ordered by last_message_at desc. " +
  'Read each thread document at body_path. Set state and a one-line summary on ' +
  "each. For any you set to needs_reply, write a draft row in state 'proposed' " +
  'with body, original_body, rationale, to_emails, subject and thread_id. ' +
  'Report a short table of what you did.'

/** Which rows a folder shows. `unreviewed` is deliberately its own folder and
 *  never merged into "Needs you": untriaged means nobody has looked yet, and
 *  folding it in made 199 of 200 threads claim to need a reply. */
const FILTERS: Record<string, { field: string; op: string; value: unknown }[]> = {
  needs_you: [
    { field: 'tier', op: 'eq', value: 'corpus' },
    { field: 'state', op: 'eq', value: 'needs_reply' },
  ],
  waiting: [
    { field: 'tier', op: 'eq', value: 'corpus' },
    { field: 'state', op: 'eq', value: 'waiting_on_them' },
  ],
  unreviewed: [
    { field: 'tier', op: 'eq', value: 'corpus' },
    { field: 'state', op: 'eq', value: 'unreviewed' },
  ],
  all: [{ field: 'tier', op: 'eq', value: 'corpus' }],
}

export function App({ mailbox, onMailboxChanged }: { mailbox: Mailbox; onMailboxChanged: () => void }) {
  const [folder, setFolder] = useState<Folder>('needs_you')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  // Narrow screens show one pane at a time; wide screens show both at once.
  const [view, setView] = useState<'list' | 'reader'>('list')
  const [q, setQ] = useState('')

  const listFolder = folder === 'drafts' ? 'all' : folder
  const threads = useLiveRecords<Thread>({
    client: lemmaClient,
    tableName: 'email_thread',
    filters: FILTERS[listFolder] ?? FILTERS.all,
    sort: [{ field: 'last_message_at', direction: 'desc' }],
    limit: 200,
    reconcile: 'refetch',
    enabled: folder !== 'rules' && folder !== 'mailbox' && folder !== 'paper',
  })

  const drafts = useRecords<Draft>({
    client: lemmaClient,
    tableName: 'draft',
    filters: [{ field: 'state', op: 'in', value: ['proposed', 'edited', 'approved'] }],
    limit: 200,
  })
  const draftByThread = useMemo(() => {
    const map = new Map<string, Draft>()
    for (const draft of drafts.records) map.set(draft.thread_id, draft)
    return map
  }, [drafts.records])

  const rows = useMemo(() => {
    let list = threads.records
    if (folder === 'drafts') list = list.filter((t) => draftByThread.has(t.id))
    const needle = q.trim().toLowerCase()
    if (needle) {
      // Matched against exactly what the row displays — sender, subject,
      // preview. Searching a field the row does not show returns "hits" that
      // look like misses.
      list = list.filter((t) =>
        [t.subject, t.summary, t.snippet, ...(t.participants ?? [])]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle)),
      )
    }
    return list
  }, [threads.records, folder, draftByThread, q])

  // Counts for the rail. Cheap: limit 1, read `total`.
  const countNeeds = useRecords<Thread>({ client: lemmaClient, tableName: 'email_thread', filters: FILTERS.needs_you, limit: 1 })
  const countWaiting = useRecords<Thread>({ client: lemmaClient, tableName: 'email_thread', filters: FILTERS.waiting, limit: 1 })
  const countNew = useRecords<Thread>({ client: lemmaClient, tableName: 'email_thread', filters: FILTERS.unreviewed, limit: 1 })
  const countAll = useRecords<Thread>({ client: lemmaClient, tableName: 'email_thread', filters: FILTERS.all, limit: 1 })
  const countRules = useRecords({ client: lemmaClient, tableName: 'standing_instruction', filters: [{ field: 'state', op: 'eq', value: 'active' }], limit: 1 })

  const countEditions = useRecords({ client: lemmaClient, tableName: 'edition', limit: 1 })

  const review = useAgentTask({ client: lemmaClient, agentName: 'mailroom', title: 'Review the next batch' })

  const selected = rows.find((t) => t.id === selectedId) ?? null

  // Keep the cursor and the open thread in step when the list changes under us.
  useEffect(() => {
    if (!rows.length) {
      setSelectedId(null)
      return
    }
    if (!rows.some((t) => t.id === selectedId)) {
      setSelectedId(rows[0].id)
      setCursor(0)
    }
  }, [rows, selectedId])

  function move(delta: number) {
    if (!rows.length) return
    const next = Math.min(Math.max(cursor + delta, 0), rows.length - 1)
    setCursor(next)
    setSelectedId(rows[next].id)
    document.querySelectorAll('.mailrow')[next]?.scrollIntoView({ block: 'nearest' })
  }

  useKeys(
    useMemo(
      () => ({
        j: () => move(1),
        k: () => move(-1),
        ArrowDown: () => move(1),
        ArrowUp: () => move(-1),
        Enter: () => setView('reader'),
        o: () => setView('reader'),
        Escape: () => setView('list'),
      }),
      [rows, cursor],
    ),
  )

  const counts: Record<Folder, number | null> = {
    needs_you: countNeeds.isLoading ? null : countNeeds.total,
    waiting: countWaiting.isLoading ? null : countWaiting.total,
    drafts: drafts.isLoading ? null : drafts.total,
    unreviewed: countNew.isLoading ? null : countNew.total,
    all: countAll.isLoading ? null : countAll.total,
    paper: countEditions.isLoading ? null : countEditions.total,
    rules: countRules.isLoading ? null : countRules.total,
    mailbox: null,
  }

  function refreshAll() {
    void threads.refresh()
    void drafts.refresh()
    void countNeeds.refresh()
    void countWaiting.refresh()
    void countNew.refresh()
  }

  return (
    <div className="client" data-view={view}>
      <Rail
        email={mailbox.email}
        folder={folder}
        counts={counts}
        onPick={(next) => {
          setFolder(next)
          setView('list')
        }}
      />

      {folder === 'paper' ? (
        <div className="reader" style={{ gridColumn: '2 / -1' }}>
          <div className="reader-inner"><Paper /></div>
        </div>
      ) : folder === 'rules' ? (
        <div className="reader" style={{ gridColumn: '2 / -1' }}>
          <div className="reader-inner"><Rules /></div>
        </div>
      ) : folder === 'mailbox' ? (
        <div className="reader" style={{ gridColumn: '2 / -1' }}>
          <div className="reader-inner"><Setup mailbox={mailbox} onChanged={onMailboxChanged} /></div>
        </div>
      ) : (
        <>
          <section className="list" aria-label={TITLES[folder]}>
            <ListHead
              folder={folder}
              count={rows.length}
              query={q}
              onQuery={setQ}
              onPick={(next) => {
                setFolder(next)
                setView('list')
              }}
            />

            {threads.isLoading ? (
              Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 52, margin: '1px 0' }} />
              ))
            ) : rows.length === 0 ? (
              <EmptyFolder
                folder={folder}
                backlog={counts.unreviewed ?? 0}
                running={review.isRunning}
                activity={review.activity}
                onReview={() => void review.run(REVIEW_INSTRUCTION).then(refreshAll)}
                onGoBacklog={() => setFolder('unreviewed')}
              />
            ) : (
              <>
                <ThreadList
                  threads={rows}
                  drafts={draftByThread}
                  me={mailbox.email}
                  selectedId={selectedId}
                  onSelect={(thread) => {
                    setSelectedId(thread.id)
                    setCursor(rows.indexOf(thread))
                    setView('reader')
                  }}
                />
                {folder === 'unreviewed' ? (
                  <div style={{ padding: '1rem' }}>
                    <button
                      type="button"
                      disabled={review.isRunning}
                      onClick={() => void review.run(REVIEW_INSTRUCTION).then(refreshAll)}
                    >
                      {review.isRunning ? 'Reviewing…' : `Review the next ${REVIEW_BATCH}`}
                    </button>
                    {review.isRunning && review.activity ? (
                      <p className="meta" style={{ marginTop: '0.5rem' }}>{review.activity}</p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section className="reader" aria-label="Conversation">
            <button
              className="quiet meta"
              type="button"
              onClick={() => setView('list')}
              style={{ margin: '0.75rem 0 0 0.75rem' }}
            >
              ← Back
            </button>
            <Reader thread={selected} mailbox={mailbox} onChanged={refreshAll} />
          </section>
        </>
      )}
    </div>
  )
}

function EmptyFolder({
  folder,
  backlog,
  running,
  activity,
  onReview,
  onGoBacklog,
}: {
  folder: Folder
  backlog: number
  running: boolean
  activity: string
  onReview: () => void
  onGoBacklog: () => void
}) {
  if (folder === 'needs_you') {
    return (
      <div className="empty">
        <h2>Nothing needs you</h2>
        {backlog > 0 ? (
          <>
            <p className="meta">
              {backlog.toLocaleString()} thread{backlog === 1 ? '' : 's'} nobody has looked at
              yet. Untriaged is not the same as needing you, so they wait in their own folder.
            </p>
            <div className="actions">
              <button type="button" onClick={onReview} disabled={running}>
                {running ? 'Reviewing…' : `Review the next ${REVIEW_BATCH}`}
              </button>
              <button className="quiet" type="button" onClick={onGoBacklog}>See them</button>
            </div>
            {running && activity ? <p className="meta" style={{ marginTop: '0.5rem' }}>{activity}</p> : null}
          </>
        ) : null}
      </div>
    )
  }
  return (
    <div className="empty">
      <h2>Nothing here</h2>
      <p className="meta">This folder is empty.</p>
    </div>
  )
}
