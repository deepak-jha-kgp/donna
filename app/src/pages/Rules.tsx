import { useMemo } from 'react'
import { useRecords, useUpdateRecord } from 'lemma-sdk/react'
import { lemmaClient } from '../lemma-client'
import { ageInDays, useRunFunction, type Rule } from '../lib'

/** The runtime splices /me/AGENTS.md into every run and truncates it at 2000
 *  characters per scope — silently, from the bottom. So rules genuinely compete
 *  for space, and the budget is shown rather than discovered. */
const PREAMBLE_BUDGET = 1600

const SCOPE_LABEL: Record<Rule['scope'], string> = {
  general: 'Always',
  drafting: 'When drafting',
  triage: 'When triaging',
  briefing: 'In the briefing',
  crm: 'About people',
}

export function Rules({ preview }: { preview?: Rule[] } = {}) {
  const rules = useRecords<Rule>({
    client: lemmaClient,
    tableName: 'standing_instruction',
    sort: [{ field: 'created_at', direction: 'desc' }],
    limit: 300,
    enabled: !preview,
  })
  const records = preview ?? rules.records
  const compile = useRunFunction()

  const proposed = records.filter((rule) => rule.state === 'proposed')
  const active = records.filter((rule) => rule.state === 'active')
  const generalChars = active
    .filter((rule) => rule.scope === 'general')
    .reduce((sum, rule) => sum + rule.text.length + 4, 40)

  const dead = useMemo(
    () =>
      active.filter((rule) => {
        const age = ageInDays(rule.created_at)
        return (rule.applied_count ?? 0) === 0 && age !== null && age > 60
      }),
    [active],
  )

  async function setState(id: string, state: Rule['state']) {
    await lemmaClient.records.update('standing_instruction', id, { state })
    await rules.refresh()
    // Rows are the source of truth; the files the agents read are compiled from
    // them. Skip this and the agent keeps following a rule you just retired.
    await compile.run('compile_instructions', { reason: 'rule state changed' })
  }

  if (!preview && rules.isLoading) return <div className="skeleton" style={{ height: 200 }} aria-busy="true" />

  return (
    <div className="column narrow">
      <h1>Your rules</h1>
      <p className="meta" style={{ marginTop: '0.35rem' }}>
        Written from your corrections, not from a form. Each one shows what it has
        actually changed.
      </p>

      {proposed.length > 0 ? (
        <section style={{ marginTop: '2rem' }}>
          <div className="group-head">
            <h2>Proposed</h2>
            <span className="meta count">{proposed.length}</span>
          </div>
          {proposed.map((rule) => (
            <div key={rule.id} className="rule-row">
              <div>
                <div className="text">{rule.text}</div>
                <div className="provenance">
                  {SCOPE_LABEL[rule.scope]} · {rule.provenance ?? 'no reason recorded'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button type="button" onClick={() => void setState(rule.id, 'active')}>
                  Keep
                </button>
                <button className="quiet" type="button" onClick={() => void setState(rule.id, 'retired')}>
                  No
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <section style={{ marginTop: '2rem' }}>
        <div className="group-head">
          <h2>Active</h2>
          <span className="meta count">{active.length}</span>
        </div>

        {active.length === 0 ? (
          <div className="empty">
            <p>No rules yet — and that is the right starting point.</p>
            <p className="meta">
              Edit a few drafts. When the same correction shows up three times, it gets
              proposed here as a rule.
            </p>
          </div>
        ) : (
          active.map((rule) => (
            <div key={rule.id} className="rule-row">
              <div>
                <div className="text">{rule.text}</div>
                <div className="provenance">{SCOPE_LABEL[rule.scope]}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="receipts">
                  {(rule.applied_count ?? 0) === 0
                    ? 'never applied'
                    : `applied ${rule.applied_count}×`}
                </div>
                <button
                  className="quiet"
                  type="button"
                  onClick={() => void setState(rule.id, 'retired')}
                  style={{ marginTop: '0.2rem' }}
                >
                  Retire
                </button>
              </div>
            </div>
          ))
        )}

        <div className="budget">
          <span className="meta">preamble</span>
          <span className="bar" data-over={generalChars > PREAMBLE_BUDGET}>
            <i style={{ width: `${Math.min(100, (generalChars / PREAMBLE_BUDGET) * 100)}%` }} />
          </span>
          <span className="meta">
            {generalChars} / {PREAMBLE_BUDGET}
          </span>
        </div>
        {generalChars > PREAMBLE_BUDGET ? (
          <p className="notice" data-tone="error">
            Over budget. Rules past this point are cut from what the agent reads, from the
            bottom — retire one rather than letting the runtime choose.
          </p>
        ) : null}

        {dead.length > 0 ? (
          <p className="notice" style={{ marginTop: '1rem' }}>
            {dead.length} rule{dead.length === 1 ? ' has' : 's have'} never been applied in
            over 60 days. They still cost budget.
          </p>
        ) : null}
      </section>
    </div>
  )
}
