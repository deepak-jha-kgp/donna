import {
  Archive,
  Clock,
  FileEdit,
  Inbox,
  Newspaper,
  Settings,
  Sparkles,
  Circle,
} from 'lucide-react'
import { useTheme, type Folder, type Theme } from '../lib'

const ITEMS: { key: Folder; label: string; Icon: typeof Inbox }[] = [
  { key: 'needs_you', label: 'Needs you', Icon: Inbox },
  { key: 'waiting', label: 'Waiting on them', Icon: Clock },
  { key: 'drafts', label: 'Drafts', Icon: FileEdit },
  { key: 'unreviewed', label: 'Not looked at', Icon: Circle },
  { key: 'all', label: 'Everything', Icon: Archive },
  { key: 'paper', label: 'The paper', Icon: Newspaper },
]

/** The rail. Counts sit on every item so the shape of the backlog is visible
 *  without opening anything, and the selected item is a SOLID fill rather than
 *  a tint — a wash reads as "hovered", a fill reads as "you are here". */
export function Rail({
  email,
  folder,
  counts,
  onPick,
}: {
  email: string
  folder: Folder
  counts: Record<Folder, number | null>
  onPick: (folder: Folder) => void
}) {
  const [theme, setTheme] = useTheme()
  const themes: { key: Theme; label: string }[] = [
    { key: 'system', label: 'auto' },
    { key: 'light', label: 'light' },
    { key: 'dark', label: 'dark' },
  ]

  return (
    <nav className="rail" aria-label="Folders">
      <div className="brand">
        <span className="name">
          Chief of <em>staff</em>
        </span>
        <span className="who">{email}</span>
      </div>

      {ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          className="fld"
          aria-current={folder === key}
          onClick={() => onPick(key)}
          type="button"
        >
          <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
          {label}
          <span className="n">{counts[key] === null ? '·' : counts[key]}</span>
        </button>
      ))}

      <div className="section">Settings</div>
      <button
        className="fld"
        aria-current={folder === 'rules'}
        onClick={() => onPick('rules')}
        type="button"
      >
        <Sparkles size={17} strokeWidth={1.75} aria-hidden="true" />
        Rules
        <span className="n">{counts.rules === null ? '·' : counts.rules}</span>
      </button>
      <button
        className="fld"
        aria-current={folder === 'mailbox'}
        onClick={() => onPick('mailbox')}
        type="button"
      >
        <Settings size={17} strokeWidth={1.75} aria-hidden="true" />
        Mailbox
      </button>

      <div className="themer" role="group" aria-label="Theme">
        {themes.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={theme === option.key}
            onClick={() => setTheme(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="foot">
        <Settings size={15} strokeWidth={1.75} aria-hidden="true" />
        <span>{email}</span>
      </div>
    </nav>
  )
}
