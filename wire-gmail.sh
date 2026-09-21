#!/usr/bin/env bash
# Register a connected mail account as this pod's mailbox.
#
#   LEMMA_POD_ID=<pod> ./wire-gmail.sh [account-id]
#
# Connecting Gmail is an organization-level thing; a pod still has to be told
# WHICH connected account is the one whose mail it reads. That is the `mailbox`
# row, and every sync reads its `account_id`. Until it exists, `gmail_sync` has
# an account but no mailbox and quietly does nothing.
#
# It does not sync anything. Reading somebody's mail is a decision they make out
# loud, not a side effect of setup.
set -euo pipefail
cd "$(dirname "$0")"
: "${LEMMA_POD_ID:?set LEMMA_POD_ID}"
export LEMMA_POD_ID

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
lemma functions run list_mailboxes --data '{"provider":"gmail"}' --json >"$TMP/cands.json" 2>/dev/null || true

python3 - "$TMP/cands.json" "${1:-}" >"$TMP/pick" <<'PY'
import json, sys
path, given = sys.argv[1], sys.argv[2]
if given:
    print(given, "(given)"); raise SystemExit
try:
    out = json.load(open(path))
except Exception:
    raise SystemExit("no candidates came back from list_mailboxes")
data = out.get("output_data") or out.get("result") or out
cands = (data or {}).get("candidates") or []
free = [c for c in cands if not c.get("already_used")] or cands
if not free:
    raise SystemExit("no connected Gmail account this pod can use")
print(free[0]["account_id"], free[0].get("email") or "(unknown address)")
PY

read -r ACCOUNT EMAIL < "$TMP/pick"
echo "mailbox: $EMAIL  ($ACCOUNT)"

lemma query run "select count(*) as n from mailbox where account_id = '$ACCOUNT'" --json >"$TMP/n.json" 2>/dev/null || echo '{"rows":[]}' >"$TMP/n.json"
N="$(python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
rows = d.get("rows") or d.get("items") or []
print(rows[0].get("n", 0) if rows else 0)
' "$TMP/n.json")"

if [ "$N" != "0" ]; then
  echo "already registered — nothing to do."
else
  python3 -c '
import json, sys
print(json.dumps({"account_id": sys.argv[1], "email": sys.argv[2], "provider": "gmail",
                  "is_active": True, "onboarding_state": "configure"}))
' "$ACCOUNT" "$EMAIL" >"$TMP/row.json"
  lemma records create mailbox --file "$TMP/row.json" >/dev/null
  echo "registered."
fi

echo
echo "Nothing has been read yet, and that is on purpose. Tell them her mailbox is"
echo "connected and ask whether to start reading; run gmail_sync when they say yes."
