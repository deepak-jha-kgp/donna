import { useCallback, useEffect, useState } from 'react'
import { lemmaClient } from './lemma-client'

/** Minimal hash router. Four routes do not justify a routing dependency. */
export function useRoute() {
  const read = () => window.location.hash.replace(/^#/, '') || '/'
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onChange = () => setRoute(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function go(path: string) {
  window.location.hash = path
}

export type Folder =
  | 'needs_you'
  | 'waiting'
  | 'drafts'
  | 'unreviewed'
  | 'all'
  | 'paper'
  | 'rules'
  | 'mailbox'

export type Thread = {
  id: string
  gmail_thread_id: string
  subject: string | null
  participants: string[] | null
  last_message_at: string | null
  last_direction: 'inbound' | 'outbound' | null
  message_count: number | null
  state: 'unreviewed' | 'needs_reply' | 'waiting_on_them' | 'done' | 'ignored'
  waiting_since: string | null
  tier: 'corpus' | 'index_only'
  summary: string | null
  snippet: string | null
  body_path: string | null
  corpus_filled: boolean | null
}

export type Draft = {
  id: string
  thread_id: string
  subject: string | null
  to_emails: string[] | null
  cc_emails: string[] | null
  body: string
  original_body: string | null
  state: 'proposed' | 'edited' | 'approved' | 'sent' | 'discarded'
  rationale: string | null
  rules_applied: string[] | null
  confidence: number | null
  sent_at: string | null
}

export type Rule = {
  id: string
  scope: 'general' | 'drafting' | 'triage' | 'briefing' | 'crm'
  text: string
  state: 'proposed' | 'active' | 'retired'
  provenance: string | null
  applied_count: number | null
  last_applied_at: string | null
  created_at?: string
}

export type Mailbox = {
  id: string
  account_id: string
  email: string
  backfill_months: number | null
  onboarding_state: 'connect' | 'configure' | 'backfilling' | 'ready'
  timezone: string | null
}

export type Cursor = {
  id: string
  kind: string
  phase: string | null
  state: string
  progress_done: number | null
  progress_total: number | null
  last_error: string | null
  last_run_at: string | null
}

/** "s.varga@bqpartners.example" -> "Sam". A lowercase monospace local-part reads
 *  as debug output; these are people. */
export function personName(address: string | null | undefined) {
  if (!address) return 'Unknown'
  const local = (address.split('@')[0] ?? address).replace(/[._-]+/g, ' ')
  return local
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** The other people on a thread — you are not news to yourself. */
export function counterparts(thread: Thread, me: string | null) {
  const all = thread.participants ?? []
  const others = all.filter((a) => a.toLowerCase() !== (me ?? '').toLowerCase())
  return others.length ? others : all
}

/** One format for a whole column. Mixing "06:04", "1d" and "26 Aug" down one
 *  column reads as three different systems arguing. Age is what triage is
 *  about — how long something has been sitting — so age is what it shows. */
export function shortDate(value: string | null | undefined) {
  if (!value) return '—'
  const then = new Date(value)
  if (Number.isNaN(then.getTime())) return '—'
  const hours = (Date.now() - then.getTime()) / 3_600_000
  if (hours < 1) return 'now'
  if (hours < 24) return `${Math.floor(hours)}h`
  const days = Math.floor(hours / 24)
  if (days < 100) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}

/** Readable stamp for a single message header. */
export function messageDate(value: string | null | undefined) {
  if (!value) return ''
  const then = new Date(value)
  if (Number.isNaN(then.getTime())) return ''
  return then.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: then.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** "Sam Varga <s.varga@bqpartners.example> — 2026-09-18T05:22:44.269Z" split into
 *  a person and a time, because a raw ISO string in a header is a leak, not a design. */
export function parseHeading(heading: string) {
  const [who, when] = heading.split(/\s+—\s+/)
  const named = /^([^<]+)</.exec(who ?? '')
  // RFC 5322 quotes any display name containing punctuation, so the raw value is
  // often `"Briefing (Deepak Jha) via Lemma" <...>`. Showing the quotes is a
  // wire format leaking onto the page.
  const display = (named?.[1] ?? who ?? '').trim().replace(/^"(.*)"$/, '$1').trim()
  return {
    who: display || 'Unknown',
    address: (/<([^>]+)>/.exec(who ?? '')?.[1] ?? '').trim(),
    when: messageDate(when),
  }
}

export function ageInDays(value: string | null | undefined) {
  if (!value) return null
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return null
  return Math.floor((Date.now() - then) / 86_400_000)
}

/** Run a pod function and surface its error rather than swallowing it. */
export function useRunFunction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (name: string, data: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const raw = (await lemmaClient.functions.run(name, data)) as unknown
      const payload = raw as { output_data?: unknown; outputData?: unknown }
      return (payload.output_data ?? payload.outputData ?? raw) as Record<string, unknown>
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally {
      setBusy(false)
    }
  }, [])

  return { run, busy, error, clearError: () => setError(null) }
}

/** Keyboard navigation. A triage queue that needs the mouse is a toy. */
export function useKeys(handlers: Record<string, (event: KeyboardEvent) => void>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      const combo = event.metaKey || event.ctrlKey ? `mod+${event.key}` : event.key
      // Only mod-combinations survive a focused editor; bare letters would
      // otherwise type themselves into the draft you are editing.
      if (typing && !combo.startsWith('mod+')) return
      const handler = handlers[combo]
      if (handler) {
        event.preventDefault()
        handler(event)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlers])
}

export type Theme = 'system' | 'light' | 'dark'

const THEME_KEY = 'cos:theme'

function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Private windows and blocked site-data throw on access. A remembered theme
    // is a convenience, never a requirement — fall through to the OS.
  }
  return 'system'
}

/** Light / dark / follow-the-OS.
 *
 *  The switcher only sets `color-scheme` (via a `data-theme` attribute); every
 *  token is a single `light-dark()` pair, so there is no second palette to keep
 *  in step. `system` removes the attribute and hands the decision back.
 */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      window.localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Not being able to remember it must not stop it applying now.
    }
  }, [theme])

  return [theme, setTheme]
}
