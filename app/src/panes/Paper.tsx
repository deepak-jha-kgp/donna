import { useEffect, useMemo, useState } from 'react'
import { useRecords } from 'lemma-sdk/react'
import { lemmaClient } from '../lemma-client'
import { shortDate } from '../lib'

type Edition = {
  id: string
  edition_date: string
  state: 'building' | 'ready' | 'delivered' | 'failed'
  headline: string | null
  item_count: number | null
  pdf_path: string | null
  html_path: string | null
  delivered_at: string | null
  error: string | null
}

type Item = {
  id: string
  ordinal: number
  section: 'needs_you' | 'ledger' | 'people' | 'world'
  headline: string
  detail: string | null
  action_hint: string | null
}

const SECTION_TITLE: Record<Item['section'], string> = {
  needs_you: 'Needs you',
  ledger: 'You promised / you are owed',
  people: 'Going quiet',
  world: 'The world',
}

/** The paper, on screen. It is delivered as a PDF to a surface — this is the
 *  same edition read back from its rows, so the numbers here are the numbers you
 *  reply with. */
export function Paper() {
  const editions = useRecords<Edition>({
    client: lemmaClient,
    tableName: 'edition',
    sort: [{ field: 'edition_date', direction: 'desc' }],
    limit: 60,
  })
  const [openId, setOpenId] = useState<string | null>(null)
  const current = editions.records.find((e) => e.id === openId) ?? editions.records[0] ?? null

  const items = useRecords<Item>({
    client: lemmaClient,
    tableName: 'edition_item',
    filters: current ? [{ field: 'edition_id', op: 'eq', value: current.id }] : [],
    sort: [{ field: 'ordinal', direction: 'asc' }],
    limit: 100,
    enabled: Boolean(current),
  })

  const grouped = useMemo(() => {
    const map = new Map<Item['section'], Item[]>()
    for (const item of items.records) {
      const list = map.get(item.section) ?? []
      list.push(item)
      map.set(item.section, list)
    }
    return [...map.entries()]
  }, [items.records])

  if (editions.isLoading) return <div className="skeleton" style={{ height: 220 }} aria-busy="true" />

  if (!current) {
    return (
      <div className="empty">
        <h2>No edition yet</h2>
        <p>
          One is built every morning at 06:30 and sent to you as a PDF. It leads with
          what needs you, then what you promised, then the world.
        </p>
        <p className="meta">Every item is numbered — reply with the number to act on it.</p>
      </div>
    )
  }

  return (
    <>
      <header className="rhead">
        <h1>{current.headline ?? current.edition_date}</h1>
        <p className="meta">
          {current.edition_date} · {current.item_count ?? 0} items · {current.state}
          {current.delivered_at ? ` · sent ${shortDate(current.delivered_at)}` : ''}
        </p>
        <div className="actions">
          {current.pdf_path ? <DownloadPdf path={current.pdf_path} /> : null}
          {editions.records.length > 1 ? (
            <select
              value={current.id}
              onChange={(event) => setOpenId(event.target.value)}
              aria-label="Choose an edition"
            >
              {editions.records.map((edition) => (
                <option key={edition.id} value={edition.id}>
                  {edition.edition_date}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </header>

      {current.error ? (
        <p className="notice" data-tone="error">Render failed: {current.error}</p>
      ) : null}

      {grouped.map(([section, list]) => (
        <section key={section} className="papersec">
          <div className="group-head">
            <h2>{SECTION_TITLE[section]}</h2>
            <span className="count">{list.length}</span>
          </div>
          {list.map((item) => (
            <div key={item.id} className="paperitem">
              {/* Same ordinal the PDF carries — so "reply 3" means the same
                  thing whether you are reading this or your phone. */}
              <span className="ord">{item.ordinal}</span>
              <span className="body">
                <span className="h">{item.headline}</span>
                {item.detail ? <span className="d">{item.detail}</span> : null}
                {item.action_hint ? <span className="a">{item.action_hint}</span> : null}
              </span>
            </div>
          ))}
        </section>
      ))}
    </>
  )
}

function DownloadPdf({ path }: { path: string }) {
  const [href, setHref] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    let url: string | null = null
    lemmaClient.files
      .download(path)
      .then((blob) => {
        if (!live) return
        url = URL.createObjectURL(blob)
        setHref(url)
      })
      .catch(() => undefined)
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])

  if (!href) return <span className="meta">preparing PDF…</span>
  return (
    <a className="pdflink" href={href} download={path.split('/').pop()}>
      Download PDF
    </a>
  )
}
