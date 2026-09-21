import { counterparts, personName, shortDate, type Draft, type Thread } from '../lib'

/** Dense mail rows: sender and age on one line, subject then preview beneath.
 *  A subject alone on a row reads as a table of subjects; the preview is what
 *  lets you skip a thread without opening it. */
export function ThreadList({
  threads,
  drafts,
  me,
  selectedId,
  onSelect,
}: {
  threads: Thread[]
  drafts: Map<string, Draft>
  me: string
  selectedId: string | null
  onSelect: (thread: Thread) => void
}) {
  return (
    <>
      {threads.map((thread) => {
        const others = counterparts(thread, me)
        const who =
          others.length > 1
            ? `${personName(others[0])} +${others.length - 1}`
            : personName(others[0])
        const draft = drafts.get(thread.id)
        // A draft waiting on you outranks the thread's own state: it is the
        // thing you can finish in four seconds.
        const kind = draft ? 'draft' : thread.state

        return (
          <button
            key={thread.id}
            className="mailrow"
            aria-selected={selectedId === thread.id}
            data-unread={thread.state === 'needs_reply' || Boolean(draft)}
            onClick={() => onSelect(thread)}
            type="button"
          >
            <span className="who">
              <span className="flags">
                <span className="pip" data-kind={kind} aria-hidden="true" />
              </span>
              {who}
            </span>
            <span className="when">{shortDate(thread.last_message_at)}</span>
            <span className="subj">
              {thread.subject ?? <em style={{ opacity: 0.6 }}>no subject</em>}
            </span>
            {thread.summary || thread.snippet ? (
              <span className="prev">{thread.summary ?? thread.snippet}</span>
            ) : null}
          </button>
        )
      })}
    </>
  )
}
