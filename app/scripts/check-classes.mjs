/** Fail the build when a className in src/ has no rule in styles.css.
 *
 *  This exists because the shell was rebuilt for three panes and styles.css was
 *  rewritten around markup that kept its old class names. Seventeen classes were
 *  orphaned at once and the settings screens shipped with browser defaults —
 *  an onboarding step list rendering as "1. 1 · mailbox". Nothing caught it,
 *  because the panes I had just built looked fine.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'src'
const CSS = 'src/styles.css'

// Set by the host or by inline style, not by our stylesheet.
const EXTERNAL = new Set(['keys'])

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const css = readFileSync(CSS, 'utf8')
const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))

const used = new Map()
for (const file of walk(SRC).filter((f) => /\.tsx?$/.test(f))) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/className=(?:"([^"]+)"|\{`([^`]*)`\})/g)) {
    const raw = (match[1] ?? match[2] ?? '').replace(/\$\{[^}]*\}/g, ' ')
    for (const name of raw.split(/\s+/).filter(Boolean)) {
      if (!used.has(name)) used.set(name, file)
    }
  }
}

const orphans = [...used].filter(([name]) => !defined.has(name) && !EXTERNAL.has(name))
if (orphans.length) {
  console.error('\nOrphaned class names — used in markup, absent from styles.css:\n')
  for (const [name, file] of orphans) console.error(`  .${name}  (${file})`)
  console.error('\nAdd the rule, or remove the class.\n')
  process.exit(1)
}
console.log(`classes ok — ${used.size} used, all defined`)
