/** Schema-faithful sample rows for the DEV-ONLY preview route.
 *
 *  Shapes and values are taken from the real synced mailbox — long unicode
 *  subjects, a thread with no subject, a name that overflows — because a layout
 *  that only survives tidy data is a layout that has not been tested.
 *  Never imported by a page; the preview route is stripped in production.
 */
import type { Draft, Rule, Thread } from './lib'

const now = Date.now()
const ago = (days: number) => new Date(now - days * 86_400_000).toISOString()

export const sampleThreads: Thread[] = [
  {
    id: 't1', gmail_thread_id: '1a0a077a627541ad',
    subject: 'Re: Invoice for ROC Consultancy Fees – FY 2024-25',
    participants: ['owner@example.com', 's.varga@bqpartners.example'],
    last_message_at: ago(0.2), last_direction: 'inbound', message_count: 6,
    state: 'needs_reply', waiting_since: null, tier: 'corpus',
    summary: 'Sam is chasing confirmation before he files',
    snippet: "Following up on this one — the filing deadline is the end of the week and I need your confirmation before I can submit.",
    body_path: '/me/mail/1a0a077a627541ad.md', corpus_filled: true,
  },
  {
    id: 't2', gmail_thread_id: '197f3a6490e3a1d5',
    subject: 'The Mainstream Invites you to be a Speaker at Digital Native Nexus 2025 on 25th July in Bengaluru',
    participants: ['owner@example.com', 'j.okafor@mercato.example'],
    last_message_at: ago(1.1), last_direction: 'inbound', message_count: 4,
    state: 'needs_reply', waiting_since: null, tier: 'corpus',
    summary: 'Joy needs a bio and headshot by Friday',
    snippet: "Just checking in on the bio and headshot — the programme goes to print Friday.",
    body_path: '/me/mail/197f3a6490e3a1d5.md', corpus_filled: true,
  },
  {
    id: 't3', gmail_thread_id: '19a1',
    subject: null,
    participants: ['owner@example.com', 'tom@northstar.example'],
    last_message_at: ago(2.4), last_direction: 'inbound', message_count: 2,
    state: 'unreviewed', waiting_since: null, tier: 'corpus',
    summary: null,
    snippet: "Alex, Jordan and Robin. I'd put Robin first — he shipped the whole scheduler in a weekend.",
    body_path: '/me/mail/19a1.md', corpus_filled: true,
  },
  {
    id: 't4', gmail_thread_id: '19b2',
    subject: 'Superagi Workshop — annual filing, signed report attached',
    participants: ['owner@example.com', 'a.lindqvist@fincorp.example', 'rhea@northstar.example'],
    last_message_at: ago(11), last_direction: 'outbound', message_count: 9,
    state: 'waiting_on_them', waiting_since: ago(11), tier: 'corpus',
    summary: 'Signed scan sent to Ana; no acknowledgement yet',
    snippet: "Attaching the signed annual report for Superagi Workshop. Please confirm receipt.",
    body_path: '/me/mail/19b2.md', corpus_filled: true,
  },
  {
    id: 't5', gmail_thread_id: '19c3',
    subject: 'Group health insurance for Gappy Ai — revised quote',
    participants: ['owner@example.com', 'm.haddad@securenow.example'],
    last_message_at: ago(26), last_direction: 'outbound', message_count: 3,
    state: 'waiting_on_them', waiting_since: ago(26), tier: 'corpus',
    summary: 'Asked for the 12-life quote; nothing back in almost four weeks',
    snippet: "Sending across the revised group health quote for 12 lives as discussed.",
    body_path: '/me/mail/19c3.md', corpus_filled: true,
  },
]

export const sampleDraft: Draft = {
  id: 'd1', thread_id: 't1',
  subject: 'Re: Invoice for ROC Consultancy Fees – FY 2024-25',
  to_emails: ['s.varga@bqpartners.example'], cc_emails: null,
  body:
    'Sam — confirmed, please go ahead and file.\n\n' +
    'The ₹48,000 figure matches what we agreed on 4 March. I have asked Rhea to ' +
    'release payment this week, so you should see it before the deadline.\n\n' +
    'Deepak',
  original_body: 'Sam — confirmed, please go ahead and file.',
  state: 'proposed',
  rationale:
    'He asked twice for a go-ahead before the filing deadline. Used the ₹48,000 ' +
    'figure from your 4 Mar thread with him. Assumed Rhea still handles ' +
    'payment — he did for the last two invoices.',
  rules_applied: ['r1', 'r2'], confidence: 0.82, sent_at: null,
}

export const sampleRules: Rule[] = [
  { id: 'r1', scope: 'drafting', text: 'Never open with pleasantries — no "hope this finds you well".',
    state: 'active', provenance: 'You deleted the opening line from 4 drafts in March.',
    applied_count: 23, last_applied_at: ago(1), created_at: ago(180) },
  { id: 'r2', scope: 'drafting', text: 'Sign off with just "Deepak", never "Best regards".',
    state: 'active', provenance: 'Changed in 6 of 6 edited drafts.',
    applied_count: 31, last_applied_at: ago(0.3), created_at: ago(150) },
  { id: 'r3', scope: 'triage', text: 'Anything from a @bqpartners.example address is time-sensitive.',
    state: 'active', provenance: 'You replied within an hour 9 times out of 10.',
    applied_count: 4, last_applied_at: ago(9), created_at: ago(40) },
  { id: 'r4', scope: 'drafting', text: 'Never commit to a date without checking with Rhea first.',
    state: 'proposed', provenance: 'You added "let me confirm with Rhea" to 3 drafts this month.',
    applied_count: 0, last_applied_at: null, created_at: ago(3) },
]

export const sampleConversation = `# Re: ANNUAL FILLING DOCUMENTS FOR SIGNATURE - SUPERAGI WORKSHOP PRIVATE LIMITED

## Ana Sakhiya <a.lindqvist@drspv.example> — ${ago(12)}
*To: Deepak Jha <owner@example.com>*

Dear sir,

PFA

## Deepak Jha <owner@example.com> — ${ago(11.9)}
*To: Ana Sakhiya <a.lindqvist@drspv.example>*

Can we sign them digitally?

On Wed, Sep 9, 2026 at 3:52 PM Ana Sakhiya <a.lindqvist@drspv.example> wrote:

> Dear sir,
>
> PFA
>
> --
> Ana Sakhiya
> DRSPV & Associates

## Ana Sakhiya <a.lindqvist@drspv.example> — ${ago(11.8)}
*To: Deepak Jha <owner@example.com>*

No

Take print out and then make sign

--
Ana Sakhiya
DRSPV & Associates
`
