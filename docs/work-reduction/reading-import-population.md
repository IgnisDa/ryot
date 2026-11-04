# Code reading: import and provider population

Estimates from reading code at `080c70cc58`, not measurements. Paths relative to `kernel/backend/src/`
unless noted.

## What the gates exercise

- Operational gate: 2 users × 1,001 items, 900 s deadline. `OperationalGateService.startWorkflowLoad`
  packs items into root `ScriptExecutionWorkflow`s for `workflow.media-import-population` (≈100 items
  per chunk under the 64 KiB context limit, ≈10 chunks per run, all concurrent). The script runs
  `kernel:entity-import` children with `ITEM_CONCURRENCY = 4`.
- Overlap gate: 5 then 20 concurrent single-item runs, 3 repetitions, 630 s total.

## Per item

| Layer                                                 | Workflows | Sandbox runs                     | Activities                                                                             |
| ----------------------------------------------------- | --------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| Chunk parent share                                    | 1/K       | ≈1/4 (one replay per 4 children) | replay observation + queue deferreds; each replay re-reads the whole journal (O(K²))   |
| `EntityImportWorkflow`                                | 1         | –                                | plan completion, deadline, settle, 35 s durable hook clock                             |
| `ProviderEntityPopulationWorkflow`                    | 1         | –                                | ensure request, claim × (1+k) with k durable 1 s sleeps, started/running/succeeded     |
| `ProviderEntityPopulationAttemptWorkflow`             | 1         | –                                | 7 (definitions, existing, validate, upsert, attach, stamp, publish)                    |
| Details `ScriptExecutionWorkflow`                     | 1         | 1                                | pin, observe, release                                                                  |
| Required hook `ensure-media-library-membership`       | 2         | 2                                | claim/prepare/finalize + script activities; `changeUserRelationships` ends the isolate |
| Required hook `record-media-library-membership-event` | 2–3       | 2                                | ≈7 + event create                                                                      |
| Async `library-summary-refresh`                       | 2–3       | 2                                | ≈7, then serialized relationship-projection background work                            |

Total ≈9–12 workflows, 5–7 sandbox runs, 35–45 activities, 25–35 application transactions per item,
plus ≈3 cluster storage statements per activity. Parents re-run their bodies from the top on every
child resume, replaying journal entries and repeating in-body transactions.

## Serializing limits

| Limit                                                     | Value                                                                              | Where                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Application DB pool (all kernel work and cluster storage) | `4 + G` = 9 in e2e; the rest of `DATABASE_POOL_MAX=100` is reserved for host calls | `platform/db/postgres.ts`, `platform/config/service.ts` |
| Sandbox concurrency G / background lane                   | 5 / `floor(G/2)` = 2 in e2e                                                        | `config/definition.ts`, `scripts/executions/queues.ts`  |
| Running population owners                                 | 8 per install                                                                      | `entities/enrichment/repository.ts`                     |
| Population admission                                      | one install-wide exclusive advisory lock per ensure and per claim poll             | same                                                    |
| Script pin                                                | plugin ingestion shared lock                                                       | `plugins/packages/ingestion-fence.ts`                   |
| Required hooks                                            | 8 concurrent, 35 s deadline each                                                   | `automations/execution.ts`                              |

## Timers

- Population waits for a slot with durable 1 s sleeps (`inMemoryThreshold: 0`) and no wakeup; durable
  clocks are persisted messages picked up by the storage read loop, whose idle period is
  `entityMessagePollInterval` (10 s default, not overridden), so a "1 s" sleep can take up to ≈10 s.
- Each required hook schedules a 35 s durable clock that still fires after the run finishes.
- Enrichment recovery every 5 s; provider admission 1 s busy / 30 s idle; fair queue 25 ms.

## Wasteful-by-design candidates

1. Five to six nested workflow levels (chunk → entity import → population → attempt → script →
   queue) plus two hook chains, each resume re-running every ancestor body.
2. Population admission: global lock, 8 slots, sleep-polling claims.
3. Nine connections for all workflow-engine and kernel work.
4. Two background sandbox slots for 5–7 runs per item.
5. Required lifecycle hooks executed per item (≈6 workflows, 4–6 sandbox runs) where a batch
   hook over the chunk would do.
