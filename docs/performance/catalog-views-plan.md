# Definition Catalog Views Plan

## Goal and scope

Cut the cost of reading the per-user definition catalog: the `user_*` views that RyotQL, the definitions recipes and the provider lookups read on almost every request. The views must return exactly the same rows. Schema changes are allowed. Keep artifact, API, compiler, archive and protocol version constants unchanged.

## Current state

Every `user_*` catalog view is built on the same per-installation derivation:

- **`user_plugin`:** `plugin_installation` join `plugin` left join `plugin_config_revision`. It computes `scope`, `config_revision_id`, `is_listed`, `is_definition_effective` and `is_executable` per row with `CASE` expressions.
- **`user_entity_schema`:** inlines a copy of that derivation and `UNION ALL`s it with a cross join of kernel schemas and `"user"`.
- **`user_event_schema`:** joins `user_entity_schema`.
- **`user_sandbox_provider`:** joins `user_plugin` and adds an `EXISTS` over `user_entity_schema`.
- **`user_relationship_schema`:** runs up to four `EXISTS` over `user_entity_schema`.
- **`user_import_source`** and **`user_integration_provider`:** join `user_plugin`.

Measured on a copy of the harness database (`tmp/perf-audit/dumps/harness-base.dmp`; 150 users, 44 plugins, 726 installations) for the user with the most schemas, at load average below 3:

| Query                                                                 | Planning   | Execution  |
| --------------------------------------------------------------------- | ---------- | ---------- |
| `entityDefinitionsRecipe` (with PF-5's materialized includes)         | 2.2–4.9 ms | 2.4–3.8 ms |
| `select * from user_sandbox_provider where user_id = …`               | 1.7–3.0 ms | 1.0–1.3 ms |
| `select * from user_entity_schema where user_id = … and is_effective` | 0.7 ms     | 0.1 ms     |

- **Planning time** is about as large as execution time. `pg_stat_statements` doesn't count it, so the harness's view metric understates the real cost.
- **The definitions recipe** runs 156 times in the harness and takes 587 ms of execution time after PF-5 (`docs/performance/plan.md`).
- **One prototype is already measured.** Replacing `user_sandbox_provider`'s `EXISTS` over `user_entity_schema` with an `EXISTS` over `definition_entity_schema` for the active revision returns identical rows for all users (8,207 = 8,207, `EXCEPT ALL` empty both ways). It is equivalent because `is_executable` implies `is_listed` and `is_definition_effective`. Execution falls by only about 15%, which shows that the `user_plugin` derivation, not the `EXISTS`, carries the cost.

## Measurement rules

- Restore the harness database with `pg_restore` into `ryot-perf-dump-pg` (database `harness`) and the reference dump with `tmp/perf-audit/dump-restore.sh` plus `p22-fill-dump.sql`.
- For each changed view or query:
  - check row equality with `EXCEPT ALL` on `row_to_json(…)::jsonb` both ways, for all users and for the three users with the most schemas;
  - time it with `explain (analyze, timing off)`, alternating old and new at least five times at load average below 5, and reporting planning and execution separately;
  - count shared buffer hits, which don't depend on load.
- Harness acceptance uses `MODE=targets python3 -I tmp/perf-audit/analyze.py`, with the same timing rules as `docs/performance/plan.md`.
- Each slice reports `bun run check` and `bun turbo --filter='!@ryot-app/e2e' test`.

## Slices

### CV-1: maintained per-installation catalog state

**Outcome.** The per-installation derivation is computed when it changes, not on every read. `user_plugin` and every view built on it read one indexed row per (user, plugin).

**Scope.**

- **A `user_plugin_state` table** keyed by `(user_id, plugin_id)` with `installation_id`, `package_id`, `scope`, `owner_user_id`, `active_revision_id`, `config_revision_id`, `health`, `is_hidden`, `sort_order`, `is_listed`, `is_definition_effective` and `is_executable`. Index `(user_id, is_listed)`.
- **Maintenance in the same transaction** as every write that changes an input: installation insert, update or uninstall; `plugin.status`, `active_revision_id` or `environment_config_revision_id`; config revision activation. Use the existing writers, or triggers if the writers are too spread out. The slice decides which, and records why.
- **Views read the table:** `user_plugin` becomes a plain select from `user_plugin_state`, and `user_entity_schema`'s inlined copy reads it too.

**Non-goals.** No change to effectiveness rules or to the columns the views expose.

**Acceptance.**

- Row equality for `user_plugin` and every dependent view, on both dumps.
- `user_sandbox_provider` execution and planning each fall by at least 50% on harness data.
- The harness has 0 failures.
- A test per maintained input proves the state row follows it: install, uninstall, hide, health change, revision activation, config activation and plugin status.

**Stop.** If keeping the table correct needs more than the existing write paths plus triggers on those tables, stop and report the list of writers.

### CV-2: remove redundant `EXISTS` over `user_entity_schema`

**Outcome.** `user_sandbox_provider` and `user_relationship_schema` no longer evaluate the `user_entity_schema` union inside `EXISTS`.

**Scope.**

- `user_sandbox_provider`: `exists (select 1 from definition_entity_schema e where e.plugin_revision_id = p.active_revision_id and e.slug = s.root_entity_schema_slug)`. This is the prototype above.
- `user_relationship_schema`: the same rewrite for source and target slugs. Keep the `is_definition_effective` and `is_listed` conditions explicit where the old `EXISTS` implied them.

**Acceptance.** Row equality on both dumps, and shared buffer hits for both views fall.

**Stop.** If any rewrite changes rows for any user, keep that view's `EXISTS` and record the counterexample.

### CV-3: planning cost of catalog queries

**Outcome.** A measured decision on whether planning time is worth cutting further after CV-1 and CV-2.

**Scope.** Investigation only:

- planning time of the definitions recipes and provider lookups before and after CV-1 and CV-2;
- whether `@effect/sql-pg` reuses prepared statements for repeated RyotQL shapes;
- whether flattening the remaining view stack (views over views) reduces planning measurably.

**Stop.** Any change to RyotQL statement preparation is a separate approved slice.

## Order

1. CV-2 first: small and independent, and it shrinks what CV-1 has to verify.
2. Then CV-1.
3. CV-3 last, against the numbers CV-1 and CV-2 leave.
