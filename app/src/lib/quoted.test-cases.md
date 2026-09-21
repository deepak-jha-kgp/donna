Cases this parser is built against, taken from the real mailbox:

1. `Can we sign them digitally?` followed by a blank line, then
   `On Wed, Sep 9, 2026 at 3:52 PM Ana Sakhiya <a.lindqvist@drspv.example> wrote:` and
   `> Dear sir,` / `>` / `> PFA` — body is the question alone.
2. `No` / blank / `Take print out and then make sign` with no quoting at all —
   nothing is hidden.
3. A message whose only `>` is someone quoting a phrase inline — not treated as
   history, because the following lines are not markers.
