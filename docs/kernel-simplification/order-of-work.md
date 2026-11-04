# Order of work

Do it in seven steps, each one deleting more than it adds, with the job table first because most later
steps move work onto it. After each step, rerun the flow probes on the VM with the tooling in
[`../work-reduction/`](../work-reduction/README.md), and record kernel lines, statements per flow and suite
CPU next to the baseline.

1. **Freeze the baseline.** Today: kernel backend 117,500 non-test lines, 93 tables, event without hooks
   97 statements, backlog event 460 ms. Targets: about 25 statements, under 100 ms and a suite under 20
   minutes. About 60,000 kernel lines is a reference point, not a budget.
2. **Add the job table and move background work onto it.** Port the job workflows that nothing durable
   awaits: frequent cron, notification delivery, account lifecycle, backups and integration sync. Entity
   import, provider population, related pages, translation, background work and automation runs are
   awaited by plugin or import workflows, or carry projections, so they move in steps 4 and 6, where those
   callers change. `workflow_runner`, `background_work`, the fair queue, admission and wake-ups are deleted
   once the last of them moves.
   - Check: ported kinds pass their e2e files.
3. **Make every request write one transaction.** Delete the 11 request-path workflows, the direct-path
   fallbacks, receipts and the double idempotency check. Add `idempotency_key` for the four request kinds in [`idempotency.md`](idempotency.md), and drop the keys and `submittedAt` from every other request.
   - Check: event create, collection membership, signup and plugin install have no workflow rows in
     their probes.
4. **Replace the four derived-state mechanisms with one fold.** Port Media consumption and history
   correction, and Fitness workout records, then drop the stream, projection and sync-generation tables.
   Background work and automation runs become jobs here.
   - Check: the 70-episode show settles in the write itself, with no polling in its tests.
5. **Remove account generations and Redis.** Reset and delete lock the user row. Replace the
   entity-interest socket as described in [`entity-updates.md`](entity-updates.md), which makes provider
   population, related pages and translation coalesced jobs. Move the search cache into process memory.
   - Check: the server starts with no Redis configured, and the e2e stack no longer runs it.
6. **Merge the six import workflows** into one workflow with a chunk cursor and one `import_item` table.
   Entity import becomes a job, and the workflows that awaited it wait on its result.
7. **Shrink the catalog and plugin tables.** Drop the 19 views, resolve the catalog in memory, fold the
   plugin tables, and run the backup memory test to decide the restore staging tables.

Tests that pin a deleted mechanism are deleted with it, not ported. The 19 kernel test files that name
workflows are the first ones to go.
