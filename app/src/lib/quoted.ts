/** Split a mail body into what was written now and the history hanging off it.
 *
 *  Every reply carries the whole thread again. Rendered raw, a two-word answer
 *  ("No") arrives under forty lines of its own quoted ancestry, and the thread
 *  view becomes the same conversation printed N times. Mail clients have
 *  collapsed this since the nineties; not doing it is what makes a mail view
 *  look like a database dump.
 *
 *  Detected, in order:
 *    - an attribution line — "On <date>, <someone> wrote:" / "-----Original
 *      Message-----" / "________________________________" (Outlook)
 *    - a run of `>` quote markers
 *    - a signature delimiter ("-- ")
 *
 *  Conservative on purpose: when nothing matches, everything is `body` and the
 *  reader shows the message whole. Hiding text a person actually wrote is a far
 *  worse failure than leaving a few quoted lines visible.
 */

const ATTRIBUTION = [
  // "On Wed, Sep 9, 2026 at 3:52 PM Ana Sakhiya <a.lindqvist@drspv.example> wrote:"
  /^\s*On .{6,140}\bwrote:\s*$/i,
  // Same, wrapped by the sender's client across two lines.
  /^\s*On .{6,140},\s*$/i,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
  /^\s*_{10,}\s*$/,
  /^\s*From:\s.+<.+@.+>\s*$/i,
  /^\s*Sent from my \w+/i,
]

const SIGNATURE = /^--\s?$/

export interface SplitBody {
  /** What this person actually wrote. */
  body: string
  /** The thread history they replied on top of, verbatim. */
  quoted: string
  /** Their signature, if it separated cleanly. */
  signature: string
}

function isAttribution(line: string) {
  return ATTRIBUTION.some((pattern) => pattern.test(line))
}

export function splitQuoted(raw: string): SplitBody {
  const text = (raw ?? '').replace(/\r\n/g, '\n')
  const lines = text.split('\n')

  let cut = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (isAttribution(line)) {
      cut = i
      break
    }

    // A run of quote markers. One stray ">" mid-message is someone quoting a
    // phrase, not the start of the history — require two of the next three
    // non-blank lines to be markers too.
    if (/^\s*>/.test(line)) {
      let markers = 0
      let seen = 0
      for (let j = i + 1; j < lines.length && seen < 3; j += 1) {
        if (!lines[j].trim()) continue
        seen += 1
        if (/^\s*>/.test(lines[j])) markers += 1
      }
      if (markers >= 2 || seen === 0) {
        cut = i
        break
      }
    }
  }

  let body = cut === -1 ? text : lines.slice(0, cut).join('\n')
  const quoted = cut === -1 ? '' : lines.slice(cut).join('\n')

  // Signature last, and only inside what remains.
  let signature = ''
  const bodyLines = body.split('\n')
  for (let i = bodyLines.length - 1; i >= 0 && i > bodyLines.length - 12; i -= 1) {
    if (SIGNATURE.test(bodyLines[i])) {
      signature = bodyLines.slice(i + 1).join('\n').trim()
      body = bodyLines.slice(0, i).join('\n')
      break
    }
  }

  return { body: body.trimEnd(), quoted: quoted.trim(), signature }
}

/** How many lines of history are hidden, for the toggle's label. */
export function quotedLineCount(quoted: string) {
  return quoted ? quoted.split('\n').filter((line) => line.trim()).length : 0
}
