# Redesign proposal: remove the cascade

Status: agreed by the owner, and the spike (move 1) is done. Nothing else here is implemented, and
implementation waits on the owner's review of the spike. It replaces the ordering in
[`strategy.md`](strategy.md), whose target design was only partly built.

## Decisions

- **Targets:** a typical write under 100 ms and the whole suite under 20 minutes on the 4-vCPU VM.
- **Plugins** may declare effects as data, changing the Plugin Kit and first-party plugins.
- **Internals** are free to change as long as user-facing features keep working. That includes where
  history-correction evidence is stored.
- **Replicas** must keep working, so cross-process ownership and wake-ups stay.

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
