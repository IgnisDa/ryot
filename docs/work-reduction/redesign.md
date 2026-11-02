# Redesign proposal: remove the cascade

Status: direction under review with the owner. Nothing here is implemented, and implementation waits
for the owner's go-ahead. It replaces the ordering in [`strategy.md`](strategy.md), whose target design
was only partly built.

## Decisions

- **Targets:** a typical write under 100 ms and the whole suite under 20 minutes on the 4-vCPU VM.
- **Plugins** may declare effects as data, changing the Plugin Kit and first-party plugins.
- **Internals** are free to change as long as user-facing features keep working. That includes where
  history-correction evidence is stored.
- **Replicas** must keep working, so cross-process ownership and wake-ups stay.
- **Greenfield:** there is no V2 production data, so schema changes need no migrations, and breaking
  changes and complete design changes are fine.
- **Sandbox:** first-party plugins stay in the sandbox, which they exist partly to demonstrate. Its 17%
  of attributed CPU is tuned last, if at all.
- **Plugin versions:** system plugins are global, not user controlled, and follow the Docker image. Users
  can run different versions of the same uploaded plugin, which the current `plugin` and
  `plugin_revision` tables already allow because each owner gets their own `plugin` row.
- **Tests:** moving rules to a faster layer happens only if the suite is still the bottleneck after the
  backend work. Real user journeys stay in e2e.

## Direction

The first proposal kept the architecture and removed steps from it. The evidence points at the foundation:
removing the cascade cut machine CPU by only 21%, and a 150-set save that barely touches those hooks
still takes 9,601 statements and 59 workflows. So the direction is:

**A write is one transaction. Anything else is stored in that transaction or is a plain job.**

1. **Commands stop being workflows.** A write is a function call and a transaction with one receipt. The
   durable engine stays for imports, provider fetches, external deliveries and durable sleeps.
2. **Store derived state, written with the source.** Computing state on read was rejected. It is cheap for
   one page, but filtering or sorting a library by state needs every row (`legacy1` in
   [`probes.md`](probes.md)). Instead, a plugin declares a summary as a RyotQL recipe, and the kernel runs
   it for only the touched subject in the source transaction. Provider-driven changes and bulk imports
   stay jobs. History correction becomes the same pattern where it can.
3. **Plugin installation rows stay, but stop being machinery.** The tables keep their shape. A real user
   has only a few installation rows; the 18,334 in `full11` came from tests installing system plugins
   for every existing user. The cost is what surrounds them: a workflow per installation, per-user
   fan-out on a system plugin change, and per-row authority checks. Installing becomes a row written in
   a transaction, a system plugin change touches one pointer, and authority is cached by revision.
4. **Reads scale with the page, not the library.** Filterable state moves to indexed columns, and the
   plugin and installation gate runs once per query instead of once per row. Stored library summaries also
   have to hold what lists sort on: `timesCompleted`, `lastCompletedAt` and `userRating` are still computed
   per row from events. RyotQL reads turn JIT off in their own transaction, which leaves other SQL
   unchanged; `legacy2` found no read that JIT clearly helped. This does not make the home page safe alone:
   `upcoming` still hits the 30 s limit with JIT off.

Every read of stored state needs a check against a real library before it changes. The lists to cover are
the All saved views, home rails, calendar, analytics and monitoring schedules. Add a repeatable check
against a large library, because the e2e suite's tiny libraries cannot catch these failures.

## What the spike showed

Removing the five hook families from `76a8cff917` ([`probes.md`](probes.md), `full12` and `full13`):

| Measure | Baseline | Hooks removed |
| --- | ---: | ---: |
| `POST /events`, mean under load | 2,378 ms | 658 ms |
| `POST /entities`, mean under load | 370 ms | 80 ms |
| Statements | 2.84 M | 1.47 M |
| Machine CPU | about 10,500 s | about 8,300 s |
| Suite, projected | 50 min | 26–38 min |

- **The cascade is the largest single server cost, and removing it is not enough.** The earlier estimate
  of 20–30 minutes after moves 2–4 now sits at the optimistic end, and the 20-minute target needs work
  beyond the cascade.
- **The hooked write path gains most.** Writes fall about 70% in handler time, which supports moves 2
  and 3 for the write target.
- **55% of baseline test time is outside server handlers** and has never been measured.
- **Reads are not the main cost**, at 19% of handler time.
- **Plugin installs are a separate cost** the proposal did not cover: 608 s of handler time remains
  with the hooks removed, more than reads.

## What the last round showed

| Finding | Evidence |
| --- | --- |
| The engine was replaced; the shape of the work was not. | Workflows per backlog create: 18 in `probes5`, about 23 in `probes11`, because every script write gained a host-call workflow. |
| The engine is no longer the cost. | 18 executions cost under 20 ms of about 1 s of CPU in the micro-benchmark. |
| Statement count stopped predicting CPU. | Slice 3a cut statements 12–18% and moved neither CPU nor latency. |
| Domain writes are a rounding error. | `full11`, shared database: about 0.5% of 3.33 M statements, for about 9,000 domain rows. |

## The decomposition that was missing

`probes11` added a write that matches no hook ([`probes.md`](probes.md)), which separates the
kernel's write path from the plugin's cascade:

| Flow | Caller | Statements | API CPU | Workflows | Scripts |
| --- | ---: | ---: | ---: | ---: | ---: |
| One event, no hooks | 179 ms | 148 | 130 ms | 2 | 0 |
| One event, `backlog` | 610 ms | 1,006 | 740 ms | 23 | 6 |
| Signup | 704 ms | 452 | 610 ms | 5 | 2 |

So for one media event:

- **The hook cascade is about 82% of API CPU, 85% of statements and 70% of caller latency.** That is
  what most of the remaining effort should remove.
- **The kernel path is still far too heavy.** 148 statements, 2 workflows and 13 receipt writes to
  insert one row, and it is not set-based: 50 events take 1,475 statements, about 27 per item.

## Why the cascade exists

Most hook runs carry no domain logic that needs a script. Each is durable plumbing around a small
decision:

| Script | What it does | Needs a sandbox run? |
| --- | --- | --- |
| `library-summary-refresh` | Maps changed events to title IDs, then requests a projection | No: the projection could declare its inputs, as event projections do |
| `reconcile-media-history` | Maps changed events to subjects, then requests user work | Mostly no: a dirty-subject declaration covers the common case |
| `ensure-media-library-membership` | Upserts one relationship to the user's library | No: a rule |
| `record-media-library-membership-event` | Writes one event for a new membership | No: part of the same rule |
| `bootstrap.*` | One `ensureUserEntities` call each | No: declared entities |
| Before policies (5) | Read-only checks and patches before commit | Sandbox yes, durability no: nothing to recover |

The computation itself is often already declarative: `librarySummarySourceRecipe` is a RyotQL recipe,
so the summary is a stored query result, reached through a hook, a job and a script.

Durable replay is rarely needed. By name, 3 of 16 after-hook scripts reach `httpCall`; provider
scripts are the main users (124 of 144). This matches
[`durability-requirements.md`](durability-requirements.md).

## Proposed moves, in order

Each move is measured with the flow probes and, at milestones, the full suite. Effects are estimates.

1. **Bound the gain first (done).** See "What the spike showed". Bootstrap scripts stayed on, because
   removing them breaks most Media tests, so signup was not part of the measured gain.
2. **Declarative plugin effects.** Generic manifest declarations, applied by the kernel in the source
   write's transaction, with no plugin IDs in kernel code:
   - user bootstrap entities;
   - membership rules: on these writes, ensure this relationship to this singleton, and record this
     event for a new one;
   - projection inputs, so a source write marks a relationship projection dirty;
   - dirty-subject work, coalesced per subject.

   Scripts stay for logic that needs them, and for private plugins. Removes every after hook from a
   backlog create and every script from signup.
3. **Commands are a function call and one transaction.**
   - Policies call the sandbox directly from the request, with no `PolicyBatchWorkflow`, queue hop or
     journal.
   - One receipt per command instead of owner, batch, item and operation rows.
   - Revision rows are immutable, so hooks, scripts and schemas are cached in process by revision ID,
     and each transaction checks one guard instead of re-reading authority. Authority, catalog and
     definition statements are about 27% of calls and the largest share of database time in `full11`.
   - Batches become set-based.
   - Oversized creates alone keep a job, for the 35 s pollable operation.
   - Target: about 25 statements and under 30 ms for a no-hook event.
4. **Scripts run once, and one job table.**
   - A write runs in its own short transaction and appends one journal row. The script continues in
     the same isolate. The journal is read only to recover from a crash. This is the original
     `design-run-once.md` goal, without a workflow per write.
   - `automation_run`, `background_work` and the projection work rows become one job model with
     attempts, deadlines and a coalescing key, drained by a worker loop.
   - The durable engine stays for what needs it: imports, durable sleeps, and scripts with external
     effects.
5. **History correction.** Evidence moves off the single library entity, so subjects stop serializing
   on one row lock (87 s of the 164 s 60-subject test in `liv9`). Compute the desired state for a
   subject and apply the difference in one commit, keeping paged steps only for genuinely long
   histories.
6. **Harness and memory.** The time outside handlers makes this more important than first ranked, so
   it starts with a measurement, run alongside move 2: how much test time is `pollUntil` waits, sleeps,
   browser waits and scheduling delay.
   - Hook-free seeding for tests not about hooks, and template databases instead of per-file
     container sets.
   - Heap snapshots of the shared server, which grew from 375 MB to about 1.1 GB in `full11` for
     reasons nobody has established.

7. **Plugin installs.** Added by the spike. `POST /plugins` takes 1.1–1.3 s and a system package change
   3–3.7 s under load, largely independent of the cascade. Profile this path before deciding on changes.

## Expected effect (estimates)

| Measure | Today | After moves 2–4 |
| --- | ---: | ---: |
| Backlog event create, caller | 610 ms | 80–150 ms |
| Backlog event create, API CPU | 740 ms | 50–100 ms |
| Signup, caller | 704 ms | 100–150 ms |
| Whole suite on the 4-vCPU VM | 50 min | 25–35 min |

The suite figure is lowered from 20–30 minutes. The spike projects 26–38 minutes from the cascade alone,
moves 3 and 4 add some, and the rest of the target depends on moves 6 and 7, which are unsized until
the time outside handlers is measured. The suite is limited to 4 workers, so test time matters as much
as machine CPU.

## What not to do

- More statement shaving and engine tuning: the last rounds show that return is spent.
- Dropping foreign keys: their checks are 22.5% of statements but 1.6% of database time.
- Replacing the sandbox runtime: sandbox runs are cheap, and the work is around them.
- Worker threads or more processes before the work is removed: that moves load and adds memory.
- Moving off Effect now: the profile shows cost following operation count. Re-measure after move 4.

## Risks

- Two ways to express an effect, rules and hooks, because private plugins keep hooks. Keep the rule
  vocabulary small and generic.
- The membership script has real conditions (`completionSilent`, kernel collection events, property
  targets) that the rule must cover, or those cases stay scripted.
- Recovery tests pin replay behavior. They must stay green; 19 kernel test files name the workflows
  and will be rewritten, while only 1 e2e file does, so the e2e suite stays a valid behavior check.
