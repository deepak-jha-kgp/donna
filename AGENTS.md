# Working in this repository

This is a Lemma pod as a directory. There is nothing to run: the unit of work is
the bundle — edit a file, import it, test the layer you touched.

How the pod *behaves* is in [files/memory/AGENTS.md](files/memory/AGENTS.md) and
the two documents beside it — `pod-map.md` says what every resource is for and who
writes it, `conventions.md` has the states, the tiers and the traps that cost a
day. Read those before changing an agent.

## Setting a fresh pod up

```bash
git clone --depth 1 https://github.com/deepak-jha-kgp/donna && cd donna
export LEMMA_POD_ID=<pod>     # already set inside a pod's own workspace
./setup.sh                    # ~15s
./wire-gmail.sh               # once a mail account is connected
```

`setup.sh` starts a Gmail connect request when the organization has no connected
account, and tells you to run `wire-gmail.sh` when it has one. Neither reads a
single message: the sync is a thing the owner asks for out loud.

## Five things that will bite you

**`--with-files` is not optional.** This pod's judgement is not in an agent row.
It is in `/memory/AGENTS.md`, `/memory/pod-map.md`, `/memory/conventions.md` and
`/memory/newspaper-template.html`. Import without them and thirteen tables, three
agents and six functions arrive intact and the pod has no idea what it is for.

**The owner is substituted at import.** `files/memory/AGENTS.md` ships with
`__OWNER__` where a mail address goes, and `setup.sh` fills it from the pod's
admin, imports, and puts the file back. A pod that inherits somebody else's owner
is worse than one that admits it has none.

**A mailbox is not a connection.** Connecting Gmail is organization-level; the pod
still has to be told which connected account is *the* one. That is the `mailbox`
row, which `wire-gmail.sh` writes. Without it `gmail_sync` has an account, no
mailbox, and quietly does nothing.

**The app under `apps/cos-app/source/` is built output, not a project.** The
project is in [app/](app/); `./app/build.sh` regenerates one from the other. That
split is the difference between an import that takes fifteen seconds and one that
takes a minute and then fails at its last step, abandoning everything after it.
`build.sh` also moves the `.env` files aside before building and refuses to write
output containing a uuid — `lemma pods export` carries `.env.local` out of a pod's
app source, so the pod id it was exported from arrives with it, and this
repository is public.

**`/memory/agents/` and `agents/pod_default/` are deliberately absent.** The first
is the assistant's accumulated memory of one pod; the second does nothing on
import, because the pod's assistant has a fixed toolset resolved at run time and
runs with the permissions of whoever is talking to it.

## Nothing here sends mail, and that is the design

`send_draft` refuses anything not in state `approved`, and only a person sets
`approved`. Agents write `draft` rows. If you change that, you have changed what
this pod *is* — say so loudly, and expect to be argued with.

The two TIME schedules (`chronicler`, `ledger`) only read mail already in the pod
and write rows, so they ship live. Nothing here reaches the outside world on a
timer.

## Layout

```
pod.json                       metadata + the ${variables} an import resolves
tables/                        13 — the mail spine, the people, the paper
agents/{mailroom,ledger,chronicler}/   JSON carries the grants
functions/                     gmail_sync, send_draft, build_edition, derive_people,
                               compile_instructions, list_mailboxes
schedules/                     two TIME jobs; both only read and write pod rows
surfaces/resend-*/             one address per agent, plus the assistant's
files/memory/                  THE BRAIN. Read before acting, every time
apps/cos-app/source/           BUILT output, uploaded as-is
app/                           the React + Vite project it is built from
setup.sh · wire-gmail.sh       set up; then point it at a mailbox
```

The general version of why this is shaped this way:
[PLAYBOOK.md](https://github.com/deepak-jha-kgp/gilfoyle/blob/main/PLAYBOOK.md).
