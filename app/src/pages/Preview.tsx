/** DEV-ONLY design harness: the real panes, rendered against sample rows, with
 *  no session. It exists because the deployed app is behind a login I should not
 *  use — and a layout nobody has looked at is a layout that is wrong. */
import { useState } from 'react'
import { Rail } from '../panes/Rail'
import { ListHead } from '../panes/ListHead'
import { ThreadList } from '../panes/ThreadList'
import { splitQuoted, quotedLineCount } from '../lib/quoted'
import { parseHeading, type Draft, type Folder, type Thread } from '../lib'
import { sampleConversation, sampleDraft, sampleRules, sampleThreads } from '../sample'
import { Rules } from './Rules'
import { Setup } from './Setup'

const me = 'owner@example.com'

export function Preview() {
  const [folder, setFolder] = useState<Folder>('needs_you')
  const [selectedId, setSelectedId] = useState<string | null>(sampleThreads[0].id)
  const [q, setQ] = useState('')

  const rows: Thread[] =
    folder === 'waiting'
      ? sampleThreads.filter((t) => t.state === 'waiting_on_them')
      : folder === 'unreviewed'
        ? sampleThreads.filter((t) => t.state === 'unreviewed')
        : folder === 'all'
          ? sampleThreads
          : sampleThreads.filter((t) => t.state === 'needs_reply')

  const drafts = new Map<string, Draft>([[sampleDraft.thread_id, sampleDraft]])
  const selected = rows.find((t) => t.id === selectedId) ?? rows[0] ?? null

  return (
    <div className="client" data-view="reader">
      <Rail
        email={me}
        folder={folder}
        counts={{ needs_you: 2, waiting: 2, drafts: 1, unreviewed: 797, all: 805, paper: 1, rules: 3, mailbox: null }}
        onPick={setFolder}
      />

      {folder === 'rules' || folder === 'mailbox' ? (
        <section className="reader" style={{ gridColumn: '2 / -1' }} aria-label="Settings">
          <div className="reader-inner">
            {folder === 'rules' ? (
              <Rules preview={sampleRules} />
            ) : (
              <Setup
                mailbox={{
                  id: 'm1',
                  account_id: 'a1',
                  email: me,
                  backfill_months: 24,
                  onboarding_state: 'backfilling',
                  timezone: 'Asia/Kolkata',
                }}
                onChanged={() => undefined}
                previewStep="backfilling"
              />
            )}
          </div>
        </section>
      ) : (
      <>
      <section className="list" aria-label="Needs you">
        <ListHead
          folder={folder}
          count={rows.length}
          query={q}
          onQuery={setQ}
          onPick={setFolder}
        />
        <ThreadList
          threads={rows}
          drafts={drafts}
          me={me}
          selectedId={selected?.id ?? null}
          onSelect={(t) => setSelectedId(t.id)}
        />
      </section>

      <section className="reader" aria-label="Conversation">
        <div className="reader-inner">
          {selected ? (
            <>
              <header className="rhead">
                <h1>{selected.subject ?? 'No subject'}</h1>
                <p className="meta">
                  Ana, Rhea · 8 messages · last 11d · {selected.state.replace(/_/g, ' ')}
                </p>
              </header>
              {sampleConversation
                .split(/\n## /)
                .slice(1)
                .map((part, index) => {
                  const [heading, ...rest] = part.split('\n')
                  const { who, address, when } = parseHeading(heading)
                  const split = splitQuoted(rest.join('\n').replace(/^\*To:.*\*\n?/, ''))
                  return (
                    <Msg
                      key={index}
                      who={who}
                      address={address}
                      when={when}
                      direction={address === me ? 'outbound' : 'inbound'}
                      split={split}
                    />
                  )
                })}

              <section className="reply">
                <div className="reply-head">
                  <h2>Reply</h2>
                  <span className="meta">proposed</span>
                  <span style={{ flex: 1 }} />
                  <span className="meta">To s.varga@bqpartners.example</span>
                </div>
                <div className="why">
                  <h3>why this draft</h3>
                  {sampleDraft.rationale}
                  {sampleRules.slice(0, 2).map((r) => (
                    <span key={r.id} className="rule">▸ {r.text}</span>
                  ))}
                  <span className="rule">confidence 82%</span>
                </div>
                <textarea className="draft-body" defaultValue={sampleDraft.body} aria-label="Draft body" />
                <div className="actions">
                  <button className="primary" type="button">Approve and send</button>
                  <button type="button">Save edit</button>
                  <span style={{ flex: 1 }} />
                  <button className="quiet" type="button">Discard</button>
                  <span className="meta"><kbd>⌘↵</kbd> send</span>
                </div>
              </section>
            </>
          ) : (
            <div className="empty"><p>Nothing here.</p></div>
          )}
        </div>
      </section>
      </>
      )}
    </div>
  )
}

function Msg({
  who,
  address,
  when,
  direction,
  split,
}: {
  who: string
  address: string
  when: string
  direction: 'inbound' | 'outbound'
  split: { body: string; quoted: string; signature: string }
}) {
  const [open, setOpen] = useState(false)
  const hidden = quotedLineCount(split.quoted)
  return (
    <article className="msg" data-direction={direction}>
      <header>
        <span className="from">{who}</span>
        {address ? <span className="meta addr">{address}</span> : null}
        <span className="meta at">{when}</span>
      </header>
      <p className="prose">{split.body || <span className="meta">(no text)</span>}</p>
      {split.signature ? <p className="prose sig">{split.signature}</p> : null}
      {hidden > 0 ? (
        <>
          <button className="quotetoggle" type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            ··· {open ? 'hide' : 'show'} {hidden} quoted line{hidden === 1 ? '' : 's'}
          </button>
          {open ? <div className="quoted">{split.quoted}</div> : null}
        </>
      ) : null}
    </article>
  )
}
