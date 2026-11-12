# Entity enrichment

Entity enrichment runs provider population and translation as durable work. Entity data and translation overlays are shared data; request state records the applicable requester's activity.

## Status

`populationStatus`, `relatedPopulationStatus`, and `translationStatus` each contain `{ availability, state }`. Availability is `missing`, `partial`, `complete`, or `none`; state is `idle`, `queued`, `running`, `retrying`, `succeeded`, `failed`, or `cancelled`.

Availability describes persisted entity data and is shared for the entity. Related availability is `none` unless the entity's provider populates related data for its schema: the provider root, or a child schema its `related` script declares (see [child related groups](../providers/README.md#child-related-groups)). State comes from the latest applicable request for the requester; translation state also matches the requested language and canonical content generation. A missing or partial value does not imply active work. An idle state means there is no applicable active request. See [RyotQL derived fields](../../ryotql/README.md#derived-fields) for the catalog contract.

## Provider population

The `details` provider input is `{ externalId, level? }`; `level` is `base` or `full` and defaults to `full`. Provider data is authoritative. The kernel does not supply existing properties to `details` or preserve omitted old property keys when it writes provider data.

A `base` population writes the root entity and child entities and publishes that data before related data is fetched. A `full` population waits for all related pages and required authoritative sweeps before it marks related data complete. Each page is written as it arrives, so clients can see partial relationships while the full population is still running. A full population does not report related availability complete if a page or required sweep has not finished successfully. Provider pagination is described in the [plugin authoring guide](../../../../../../packages/plugin-kit/README.md#paged-related-groups).

## Translation inputs and freshness

Each `translate` script declares `translationInputs`: supported entity-schema slugs mapped to the canonical property keys the script needs. The declaration is pinned with the provider script revision. The kernel supplies only those selected canonical properties. Missing selected properties or an oversized translation input fails closed; the kernel does not fall back to passing all properties. A `related` script's `relatedInputs` selects child properties the same way.

Canonical `contentGeneration` increments only when entity `name` or canonical `properties` change. Translation work captures that generation, and the overlay stores it as `sourceContentGeneration`. Commit accepts an overlay only while its source generation still matches the entity, so stale translation work cannot replace an overlay for newer canonical content.

A successful empty translation result is a negative-cache success, not a failure. The request state remains `succeeded`, distinct from `failed`, even though translation availability is `none`.

## Request lifecycle

Admission persists the request and queues its job in the same transaction. The request retains operation, target, requester, and captured execution data; each attempt keeps the request's causation linkage. `enrichment-updated` is a status/progress refresh hint. It does not trigger translation progression or settle client progress; `populated` is the progression signal.

Automatic retry is bounded to three attempts total. Only `infrastructure` or `timeout` failures with no boundary code/data are retried, 5 and then 10 seconds apart. Other failures are terminal for that request.

`POST /entities/:entityId/enrichment` selects `operation: "population" | "translation"`,
and `action: "refresh" | "retry"`. It returns `enrichmentRequestId`, or null when no work is
admitted. A retry links to the caller's failed or cancelled request. A refresh does not require a
failure. A resent request joins the compatible active request.

Population admission is shared by imports, populate requests, monitoring, refresh and retry. Compatible
active requests share one fetch under the same provider, external ID, schema owner, data scope,
and revision/config pin. Requester rows retain separate account authority and outcomes. A refresh
never joins an ensure-only request, and full work never joins base-only work. Each owning request
queues one job, interactive before background; each process runs at most eight. At most 1,000 active
requester rows exist across the installation and 50 per user. Queued jobs hold no sandbox slot.
Manual refresh can reuse a successful matching refresh for one minute; failed work has no cooldown.

Each provider write transaction locks and checks its active owning request. Settled or cancelled
work cannot resume writing after its successor starts. Existing data remains readable during work;
partial failure retains committed base data and successful related pages. Provider refresh does not
write user history, annotations, library intent, or monitoring choices, and does not recursively
refresh the related graph. Existing provider-change detectors still run.

Manual population refresh requests the caller's current-language translation after canonical work,
including unchanged canonical content. It does not refresh every language. Translation commit checks
both canonical generation and the latest admitted translation request for that entity/language, so
an older same-generation translation cannot replace a newer refresh. Explicit translation admission
failures also retain a failed request and expose Retry without invalidating successful canonical data.

## Freshness contract

`entity.providerCheckedAt` is the latest successful provider details check whose root and child sets
committed. It advances for unchanged successful responses, not for cached ensure results, admission,
or failures before that boundary. It is separate from request activity and generic entity edits.
Related completion remains separate: a base success is not proof that authoritative related pages
finished. Last successful check evidence survives later failed requests and request-history pruning.

Successful data whose schema declares a refresh interval is refreshed when a page asks for it after
that interval, at most once per day while the provider keeps failing. Other data refreshes only on
explicit request or through monitoring. Future release delivery must require
a successful canonical/inventory check within its declared freshness window and completed inventory
work when that inventory is needed. Translation and generic update times cannot satisfy that gate.
An alert producer must refresh or defer stale candidates and define its window/catch-up policy before
shipping; display queries can continue to show cached data. This feature sends no release alerts.

The job settles its request and releases its retained actor/script registration. The frequent cron fails at most 100 active requests per pass whose job no longer exists, such as one deleted with its account. Superseded terminal requests are pruned after 168 hours.

## Coordinated rollout

The schema is shipped as a generated fresh baseline. Rebuild shipped and private plugin artifacts for the same release; mixed-release script replay is unsupported. Legacy imports follow the [server migration guide](../../../../../../apps/server/src/migrations/README.md). Restored dependencies start without a related-completion stamp and are rechecked lazily when a page asks for them interactively; see [backups](../../backups/README.md).
