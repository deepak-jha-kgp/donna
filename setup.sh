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
cp pod.json "$META/"
if ! lemma pods import "$META" --set-pod-meta >/dev/null 2>&1; then
  echo "note: could not name this pod 'donna' — something else in this" >&2
  echo "      organization already is. Carrying on; nothing depends on it." >&2
fi

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
if ! lemma pods import . --with-files --var "cos_app_slug=$SLUG" >"$LOG" 2>&1; then
  echo "the import failed. Full output:" >&2
  cat "$LOG" >&2
  exit 1
fi

# 4. Read back what landed.
APP_URL="$(lemma apps get cos-app --output json | python3 -c 'import json,sys; print(json.load(sys.stdin).get("url") or "")')"
MAIL="$(lemma surfaces list --output json | python3 -c '
import json, sys
d = json.load(sys.stdin)
for s in (d["items"] if isinstance(d, dict) else d):
    if s["name"] == "resend-assistant":
        print((s.get("reach") or {}).get("email") or "-"); break
else: print("-")
')"
BRAINS="$(lemma files ls /memory --json 2>/dev/null | python3 -c '
import json, sys
try: print(len([r for r in json.load(sys.stdin)["items"] if r.get("kind") == "FILE"]))
except Exception: print("?")
')"
GMAIL="$(lemma connectors accounts list --output json 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    rows = d["items"] if isinstance(d, dict) else d
    print("connected" if [a for a in rows
          if a.get("connector_id") == "gmail" and a.get("status") == "CONNECTED"] else "none")
except Exception: print("none")
')"
if [ "$GMAIL" = "connected" ]; then
  STEP="  A mail account is already connected to this organization. Run ./wire-gmail.sh"
  STEP2="  to register it here, then they say the word and you sync."
else
  STEP="  Connect a mailbox — nothing works until you do:"
  STEP2="  $(lemma connectors connect-requests create gmail --output json 2>/dev/null \
        | python3 -c 'import json,sys; print(json.load(sys.stdin).get("authorization_url") or "(no authorization url came back — set gmail up on the connectors page)")' 2>/dev/null \
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

  There is a desk at
  $APP_URL
  for the threads, the drafts and the morning paper, and you can mail her at $MAIL.

TXT
