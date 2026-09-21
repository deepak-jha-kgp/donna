import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthGuard, useRecords } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'
import { useRoute, type Mailbox } from './lib'
import { App } from './App'
import { Setup } from './pages/Setup'
import { Preview } from './pages/Preview'
import './styles.css'

const queryClient = new QueryClient()

function Shell() {
  // One read decides the shape of everything: without a mailbox there is nothing
  // to show but onboarding, and an empty client would be a lie.
  const mailboxes = useRecords<Mailbox>({
    client: lemmaClient,
    tableName: 'mailbox',
    filters: [{ field: 'is_active', op: 'eq', value: true }],
    limit: 5,
  })
  const mailbox = mailboxes.records[0] ?? null
  const onChanged = () => void mailboxes.refresh()

  if (mailboxes.isLoading) {
    return (
      <div className="reader">
        <div className="reader-inner">
          <div className="skeleton" style={{ height: 220 }} aria-busy="true" />
        </div>
      </div>
    )
  }
  if (mailboxes.error) {
    return (
      <div className="reader">
        <div className="reader-inner">
          <p className="notice" data-tone="error">
            Could not read your mailbox settings: {mailboxes.error.message}
          </p>
        </div>
      </div>
    )
  }
  if (!mailbox || mailbox.onboarding_state !== 'ready') {
    return (
      <div className="reader">
        <div className="reader-inner" style={{ maxWidth: '34rem' }}>
          <Setup mailbox={mailbox} onChanged={onChanged} />
        </div>
      </div>
    )
  }
  return <App mailbox={mailbox} onMailboxChanged={onChanged} />
}

function Root() {
  const route = useRoute()

  // Design harness, dev builds only. Outside AuthGuard on purpose: it renders
  // the real components against sample rows, so it needs no session.
  if (import.meta.env.DEV && route === '/preview') return <Preview />

  return (
    <AuthGuard client={lemmaClient}>
      <Shell />
    </AuthGuard>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </React.StrictMode>,
)
