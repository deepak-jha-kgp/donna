import type { Folder } from '../lib'

/** The three folders worth one tap from anywhere. The rail holds the rest. */
export const SEGMENTS: { key: Folder; label: string }[] = [
  { key: 'needs_you', label: 'Needs you' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'all', label: 'Everything' },
]

/** A sentence, not a row count. "3 of 802" tells you nothing you can act on. */
export const SUBTITLES: Record<Folder, (n: number) => string> = {
  needs_you: (n) => (n === 0 ? 'Nothing waiting on you' : `${n} waiting on you`),
  waiting: (n) => (n === 0 ? 'Nothing outstanding' : `${n} where the ball is theirs`),
  drafts: (n) => (n === 0 ? 'No drafts yet' : `${n} ready to approve`),
  unreviewed: (n) => (n === 0 ? 'All caught up' : `${n} nobody has read yet`),
  all: (n) => `${n} conversations`,
  paper: () => 'This morning, and every morning before it',
  rules: () => 'Written from your corrections',
  mailbox: () => 'The account this runs on',
}

export const TITLES: Record<Folder, string> = {
  needs_you: 'Needs you',
  waiting: 'Waiting on them',
  drafts: 'Drafts',
  unreviewed: 'Not looked at',
  all: 'Everything',
  paper: 'The paper',
  rules: 'Rules',
  mailbox: 'Mailbox',
}

/** One copy, used by the app and by the dev harness. The harness previously
 *  carried its own list head, so a search field added to the app never appeared
 *  in the preview — the drift the class guard cannot catch. */
export function ListHead({
  folder,
  count,
  query,
  onQuery,
  onPick,
}: {
  folder: Folder
  count: number
  query: string
  onQuery: (value: string) => void
  onPick: (folder: Folder) => void
}) {
  return (
    <div className="list-head">
      <h1>{TITLES[folder]}</h1>
      <p className="sub">{SUBTITLES[folder](count)}</p>

      <input
        className="search"
        type="search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search sender, subject or preview…"
        aria-label="Search this folder"
      />

      <div className="segs" role="group" aria-label="Filter">
        {SEGMENTS.map((segment) => (
          <button
            key={segment.key}
            type="button"
            aria-pressed={folder === segment.key}
            onClick={() => onPick(segment.key)}
          >
            {segment.label}
          </button>
        ))}
      </div>
    </div>
  )
}
