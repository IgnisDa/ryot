# Order of work

Status: agreed with the owner. Phase A is built, with steps 0, 1, 2 and 5 done, step 3 dropped, and steps 4 and 6
open as noted. It replaces the ordering in [`redesign.md`](redesign.md), whose direction and evidence still apply.

Each step lands on its own, with `[reduce-work]` commits, and has to meet its check before the next starts.
"Library check" means the reads in step 0 on `tmp/file2.sql`, run with `LIBRARY_CHECK_TODAY` at the dump's date and
at a busy week, because a dump's date windows empty out as it ages. "Flow probes" and "suite" run on the VM.

## Phase 0: make the checks repeatable

**0. Library check and baseline triage.**
- Keep the temporary `legacy2` reads and plan capture as a script that restores a dump into disposable
  containers. They stay out of the e2e suite, and dumps stay local.
- Run `collection-detail` and `entity-reminders` several times to see whether they are flaky or real, and fix
  them if real. The 4 `history-correction-liveness` failures stay until step 10.
- Check: the script reproduces the `legacy2` table.

## Phase A: reads

These fix what real users hit now, and do not depend on the write redesign.

| Step | Change | Evidence | Check on `tmp/file2.sql` |
| --- | --- | --- | --- |
| **1. JIT off for reads** | `jit=off` in the RyotQL transaction, next to `statement_timeout` | `legacy2`: 3 of 3 page loads killed with JIT on, 0 of 3 off | No kill in 3 page loads at 1 GB |
| **2. Compute the page first** | RyotQL filters, sorts and limits first, then computes display fields for the page's rows only | `legacy3`: 607,521 episode visits for 21 rows; the name sort needs 2,708 | Default view and stored-value sorts under 1 s |
| **3. Store what lists sort on** | Dropped: `a4`–`a6` have those sorts under 1 s without it | `timesCompleted` also depends on asynchronous stream contributions, so storing it would need a new kernel trigger | |
| **4. One gate per query** | The plugin and installation check runs once, not per row. Decide after step 5: flat rails are at 135 ms | `legacy3`: flat rail does 29,460 projection and installation lookups for 1 row | Flat rails under 100 ms |
| **5. Indexed dates** | Upcoming and calendar start from an indexed date, not by parsing every episode | `a5`, `a6`: `upcoming` fails at 30 s; prototype in `probes.md` | Each under 500 ms on both dates |
| **6. Memory and background load** | Trace the background query that slows reads, then bound concurrent reads if still needed | `upcoming`: 4.5 s alone, 20–28 s beside it | Whole home page under 2 s, no kill at 1 GB under background load |

Step 5 is described in [`design-indexed-date.md`](design-indexed-date.md). Its check is met in `a7`–`a9`. So is
step 6's whole-page check, without tracing the background query, so that trace and any read limit wait until a
read needs them. Step 4 would only serve flat rails at about 140 ms against 100 ms.

**Phase check:** the whole suite still passes, because tiny libraries do not exercise these paths. This phase is
not expected to shorten it much.

## Phase B: writes

The moves from `redesign.md`, in the order that removes the most work first. Flow probes after each step, and
the suite after steps 7, 8 and 9.

**7. Declarative plugin effects.** Done in this order, each its own commit: bootstrap entities, membership rules,
projection inputs written in the source transaction, dirty-subject work. Check: no after hook on a backlog create,
no script on signup, and summaries still match live values.

**8. Commands are one transaction.** Direct policy calls, one receipt per command, revisions cached in process,
set-based batches. Check: about 25 statements and under 30 ms for a no-hook event, and a 150-set workout save far
below today's 9,601 statements.

**9. Scripts run once, and one job table.** Check: no workflow per script write, and the recovery tests pass after
being rewritten for the new shape.

**10. History correction.** Evidence moves off the single library row, and a subject's changes apply in one commit.
Check: the 4 liveness tests pass and the 60-subject case stops serializing.

**11. Plugin installs.** Profile first, then install in one transaction, move one pointer for a system plugin
change, and remove per-user fan-out. The `plugin`, `plugin_revision` and `plugin_installation` tables keep their
shape. A revision that changes a summary recipe queues a rebuild for that plugin's data only. Check: `POST /plugins`
and system package changes well below today's 1.1–3.7 s.

## Phase C: the suite

**12. Remove the waiting.** `full15` shows 41% of test time asleep between polls. Rerun the timer after step 9, drop
polling where a write now finishes in its transaction, and shorten what is left. Then seed without hooks where a
test is not about hooks, and use template databases. Check: suite under 20 minutes on the 4-vCPU VM, or a measured
account of what stands in the way.

**13. Server memory.** Heap snapshots for the growth from 375 MB to about 1.1 GB, if it is still there.

**14. Sandbox tuning, last and only if needed.** First-party plugins stay sandboxed.

## Finishing

At the end of the code changes: `.agents/skills/codebase-cleanup`, then `bun run check`, then
`bun turbo --filter='!@ryot-app/e2e' test`, and only affected e2e files outside the milestone runs above.
