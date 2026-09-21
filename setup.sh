#!/usr/bin/env bash
# Set a fresh pod up. One command, about fifteen seconds.
#
#   LEMMA_POD_ID=<pod> ./setup.sh
#
# It does not sync anybody's mail and does not send anything. Both are decisions
# a person makes afterwards, out loud.
set -euo pipefail
cd "$(dirname "$0")"
: "${LEMMA_POD_ID:?set LEMMA_POD_ID to the pod to set up}"
export LEMMA_POD_ID

# 1. The name, first and on its own.
#
#    First, because the four email surfaces take their addresses from the pod's
#    name at the moment they are created -- rename afterwards and the pod is
#    `donna` while its inboxes still read whatever made it.
#
#    On its own, because `--set-pod-meta` applies metadata BEFORE any resource
#    and pod names are unique per organization: a second `donna` in the same org
#    is a 409 that would take the whole import down with it.
META="$(mktemp -d)"; trap 'rm -rf "$META"' EXIT

# 2. Whose mail this is. The pod's own rules open by naming an owner, and a pod
#    that inherits somebody else's is worse than one that admits it has none, so
#    the line is filled in from this pod's admin at import time and put back
#    afterwards -- the checkout stays as it was in git.
OWNER="$(lemma pods members --output json 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    rows = d["items"] if isinstance(d, dict) else d
    admins = [r for r in rows if "POD_ADMIN" in (r.get("roles") or [])] or rows
    print(admins[0].get("email") or "whoever set this pod up")
except Exception:
    print("whoever set this pod up")
')"
BRAIN="files/memory/AGENTS.md"
cp "$BRAIN" "$META/AGENTS.md.orig"
trap 'cp "$META/AGENTS.md.orig" "$BRAIN" 2>/dev/null || true; rm -rf "$META"' EXIT
python3 - "$BRAIN" "$OWNER" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); p.write_text(p.read_text().replace("__OWNER__", sys.argv[2]))
PY

# 3. Everything else, quietly.
#
#    --with-files is not optional: this pod's judgement is in /memory/AGENTS.md,
#    /memory/pod-map.md, /memory/conventions.md and the newspaper template beside
#    them. Without them every table, agent and function arrives intact and the
#    pod has no idea what it is for.
#
#    The app slug is named explicitly: it is globally unique across every pod on
#    the server and the CLI's fallback is the pod id's first EIGHT hex characters,
#    which two pods created in the same moment share. That 409 kills the app step
#    and takes the whole import with it. The id's tail is random; use that.
SLUG="cos-app-$(printf '%s' "${LEMMA_POD_ID//-/}" | tail -c 12)"
LOG="$(mktemp)"
echo "setting up — about fifteen seconds"
# One call when the pod's name is free. `--set-pod-meta` applies metadata before
# any resource, so the email surfaces are created already carrying the new name --
# and if the name is taken it is a 409 that aborts in seconds, before anything
# exists, which is why the fallback is a plain re-import rather than a repair.
if ! lemma pods import . --set-pod-meta --with-files --var "cos_app_slug=$SLUG" >"$LOG" 2>&1; then
  if grep -q 'POD_CONFLICT' "$LOG"; then
    echo "note: could not name this pod 'donna' — something else in this" >&2
    echo "      organization already is. Importing without the rename." >&2
    if ! lemma pods import . --with-files --var "cos_app_slug=$SLUG" >"$LOG" 2>&1; then
      echo "the import failed. Full output:" >&2; cat "$LOG" >&2; exit 1
    fi
  else
    echo "the import failed. Full output:" >&2; cat "$LOG" >&2; exit 1
  fi
fi

# The importer applies grants LAST -- after schedules, after surfaces, after
# files. Anything that fails in between takes them with it and leaves workloads
# granted nothing at all: an import that printed "created" for every resource
# and a pod that cannot do a single thing. That is not hypothetical; it happened
# on a pod whose own email surface was named slightly differently from this
# bundle's, and it cost somebody six minutes of reading CLI source to work out
# why. So read the grants back, and put them back from the bundle if they are
# missing. `--from-bundle` exists for exactly this.
for kind in agents functions; do
  [ -d "$kind" ] || continue
  for dir in "$kind"/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    have="$(lemma "$kind" permissions get "$name" --output json 2>/dev/null \
      | python3 -c 'import json,sys
try: print(len(json.load(sys.stdin).get("grants") or []))
except Exception: print(-1)' 2>/dev/null || echo -1)"
    if [ "$have" = "0" ]; then
      echo "note: $name imported with no grants — restoring them from the bundle" >&2
      lemma "$kind" permissions replace "$name" --from-bundle "$dir" >/dev/null 2>&1 || true
    fi
  done
done

# 4. Read back what landed. All of these are independent, so they go at once
#    rather than one after another -- four round trips in the time of the slowest.
D="$(mktemp -d)"
lemma apps get cos-app --output json      >"$D/app"  2>/dev/null &
lemma surfaces list --output json         >"$D/surf" 2>/dev/null &
lemma files ls /memory --json             >"$D/mem"  2>/dev/null &
lemma connectors accounts list --output json >"$D/acc" 2>/dev/null &
wait

APP_URL="$(python3 -c '
import json, sys
try: print(json.load(open(sys.argv[1])).get("url") or "")
except Exception: print("")
' "$D/app")"
MAIL="$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    for s in (d["items"] if isinstance(d, dict) else d):
        if s["name"] == "resend-assistant":
            print((s.get("reach") or {}).get("email") or "-"); break
    else: print("-")
except Exception: print("-")
' "$D/surf")"
BRAINS="$(python3 -c '
import json, sys
try: print(len([r for r in json.load(open(sys.argv[1]))["items"] if r.get("kind") == "FILE"]))
except Exception: print("?")
' "$D/mem")"
GMAIL="$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    rows = d["items"] if isinstance(d, dict) else d
    print("connected" if [a for a in rows
          if a.get("connector_id") == "gmail" and a.get("status") == "CONNECTED"] else "none")
except Exception: print("none")
' "$D/acc")"
rm -rf "$D"

# A command has no business in the message a person reads. When a mailbox is
# already connected they get a question; the command that answers it is in the
# frame above, addressed to the agent.
if [ "$GMAIL" = "connected" ]; then
  STEP="  A mailbox is already connected here, so there is nothing for you to set up."
  STEP2="  Say the word and she starts reading it."
else
  STEP="  Connect a mailbox — nothing works until you do:"
  STEP2="  $(lemma connectors connect-requests create gmail --output json 2>/dev/null \
        | python3 -c 'import json,sys; print(json.load(sys.stdin).get("authorization_url") or "(no authorization url — set gmail up on the connectors page)")' 2>/dev/null \
        || echo '(could not start a gmail connect request — set it up on the connectors page)')"
fi

cat <<TXT

────────────────────────────────────────────────────────────────────────────
 FOR YOU, NOT FOR THEM. Say the following in your own words, as one short
 message in prose. No command, no code block, no copy of this frame. They
 are very likely on a phone, and they did not ask for a terminal.
 (owner recorded as $OWNER · $BRAINS playbooks under /memory — if that is 0
  the import went in without --with-files and this pod knows nothing.
  gmail: $GMAIL · log: $LOG)

 When they answer, YOU do the thing — never hand them a command:
   gmail already connected   -> ./wire-gmail.sh registers it as this pod's mailbox.
                                It reads nothing; the sync is a separate yes.
   anybody waiting on a sync -> show /samples/newspaper.png while it runs. It is a
                               full edition on invented correspondence; say that as
                               you show it, never as a preview of their inbox.
   they want their mail read -> ./wire-gmail.sh, then gmail_sync. Read
                                /memory/conventions.md first: tier='corpus' is
                                real correspondence, index_only is bulk mail and
                                you never draft from it.
   they asked for a reply    -> write a draft row. NEVER send. send_draft only
                                delivers what a person has marked approved, and
                                that is the whole safety story of this pod.
   a schedule woke you       -> nobody is watching. Never ask_user; decide, and
                                say what you assumed.
────────────────────────────────────────────────────────────────────────────

  Donna is set up. She has no mail yet, and that is the only thing missing.

  Once a mailbox is connected she reads it the way a chief of staff would: what
  is actually waiting on you, who you owe an answer to, what you promised and
  when — and every morning, one briefing rather than an inbox.

  She drafts replies in your voice. She never sends one. A draft sits until you
  say it is good, and only then does it go.

$STEP
$STEP2

  Then: show me what's waiting on me

  She will show you a sample edition first — invented correspondence, clearly marked —
  so you can see the paper before there is any of your own mail in it.

  There is a desk at
  $APP_URL
  for the threads, the drafts and the morning paper, and you can mail her at $MAIL.

TXT
