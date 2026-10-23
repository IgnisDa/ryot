# Kernel Backend

- Read `README.md` for persistence, workflow, and test infrastructure conventions; feature READMEs own their protocols.
- Routes validate and call one service handler. Services own access control and business rules; repositories own persistence and normalization. Declare services and repositories as Effect service classes.
- Each table has one runtime writing repository. All entrypoints use its owning service; shared transactions and backup-owned historical restore are the only cross-module persistence exceptions.
- Depend only on more generic modules. Invert upward effects through generic ports and durable workers, never reverse imports.
- Keep explicit per-file package exports for real external consumers, with no wildcard or barrel.
- Expose persisted-row reads through RyotQL catalog tables and recipes. HTTP reads are for non-row data; writes return identifiers or genuine command results, not read models.
- Provider enrichment and foreign-ID resolution use sandbox provider scripts. Pass provider-native IDs only as resolved inputs; source connectors may fetch user data, not enrichment APIs.
- Services own transactions. Repositories capture `DatabaseSession` and use `session.run`; raw executors stay inside its callback. Never hold a transaction across sandbox/network I/O, workflow boundaries, sleeps, or fan-out.
- Validate schema-backed properties before writes. Keep persisted JSON and schemas aligned; store timezone-aware timestamps and emit UTC ISO dates. Auth patches validated preferences on the user row, never from session copies.
- Mutation receipts own replay independently of automation history. Retain change evidence only for matching hooks or pending batch candidates; start execution after commit.
- Catalog reads exclude script bodies and hot manifest reads. Use persisted revision sections and definition views; cold manifest owners are enforced by `ryot/no-hot-manifest-read`.
- Keep batch locks, receipts, and lookups set-based. Historical restore persistence belongs only to backups.
- One durable owner implements each business operation. Activities never dispatch workflows/queues; workflow bodies do. Use deterministic child execution IDs and idempotent owners.
- Register activities/workflows through `makeActivity` and `implementWorkflow` in `src/platform/workflow/scope.ts`; never call `LifecycleExecution.after` or `executePolicy` inside activities.
- Redis infrastructure owns backend keys and codecs; sandbox recovery keys remain sandbox-owned.
- Assert typed failures with `assertExitFails`. Database/Redis tests use shared setup URLs with isolated schemas/databases or namespaced keys; never skip because a URL is absent.
