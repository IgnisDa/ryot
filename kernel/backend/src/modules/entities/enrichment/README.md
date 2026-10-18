# Entity enrichment

Entity enrichment runs provider population and translation as durable work. Entity data and translation overlays are shared data; request state records the applicable requester's activity.

## Status

`populationStatus`, `relatedPopulationStatus`, and `translationStatus` each contain `{ availability, state }`. Availability is `missing`, `partial`, `complete`, or `none`; state is `idle`, `queued`, `running`, `retrying`, `succeeded`, `failed`, or `cancelled`.

Availability describes persisted entity data and is shared for the entity. State comes from the latest applicable request for the requester and account generation; translation state also matches the requested language and canonical content generation. A missing or partial value does not imply active work. An idle state means there is no applicable active request. See [RyotQL derived fields](../../ryotql/README.md#derived-fields) for the catalog contract.

## Provider population

The `details` provider input is `{ externalId, level? }`; `level` is `base` or `full` and defaults to `full`. Provider data is authoritative. The kernel does not supply existing properties to `details` or preserve omitted old property keys when it writes provider data.

A `base` population writes the root entity and child entities and publishes that data before related data is fetched. A `full` population waits for all related pages and required authoritative sweeps before it marks related data complete. Each page is written as it arrives, so clients can see partial relationships while the full population is still running. A full population does not report related availability complete if a page or required sweep has not finished successfully. Provider pagination is described in the [plugin authoring guide](../../../../../../packages/plugin-kit/README.md#paged-related-groups).

## Translation inputs and freshness

Each `translate` script declares `translationInputs`: supported entity-schema slugs mapped to the canonical property keys the script needs. The declaration is pinned with the provider script revision. The kernel supplies only those selected canonical properties. Missing selected properties or an oversized translation input fails closed; the kernel does not fall back to passing all properties.

Canonical `contentGeneration` increments only when entity `name` or canonical `properties` change. Translation work captures that generation, and the overlay stores it as `sourceContentGeneration`. Commit accepts an overlay only while its source generation still matches the entity, so stale translation work cannot replace an overlay for newer canonical content.

A successful empty translation result is a negative-cache success, not a workflow failure. The activity state remains `succeeded`, distinct from `failed`, even though translation availability is `none`.

## Request lifecycle

Admission persists the request before dispatching the root workflow. The durable request retains operation, target, requester/account generation, and captured execution data; attempt workflows retain the root request's parent and causation linkage. `enrichment-updated` is a status/progress refresh hint. It does not trigger translation progression or settle client progress; `populated` is the progression signal.

Automatic retry is bounded to three attempts total. Only `infrastructure` or `timeout` failures with no boundary code/data are retried. The two durable waits are 5 seconds and 30 seconds. Other failures are terminal for that request.

Manual retry selects `operation: "population" | "translation"` and admits a new request linked to the failed or cancelled request. It has no failure-column clearing step and uses no hourly retry bucket in request IDs.

Recovery examines at most 100 requests per pass and polls every 5 seconds. A suspended workflow is not terminal. Recovery records a terminal result only after the workflow completes, then releases its retained actor/script registration. Compact latest outcomes remain available after workflow execution data is garbage-collected. Superseded terminal requests are pruned after 168 hours once their registration is released.

## Coordinated rollout

The schema is shipped as a generated fresh baseline. Rebuild shipped and private plugin artifacts for the same release; mixed-release workflow replay is unsupported. Legacy imports follow the [server migration guide](../../../../../../apps/server/src/migrations/README.md). Restored dependencies start without a related-completion stamp and are rechecked lazily on foreground interest; see [backups](../../backups/README.md).
