# Automations

Automation occurrences are immutable records of what triggered automation. Lifecycle occurrences retain before and after snapshots, signals retain their emitted payload, and provider imports retain their provider identity. The occurrence is persisted before rules are resolved or work is dispatched. Reusing an occurrence ID with identical data is an idempotent replay; reusing it with different data fails.

## Execution

`AutomationInput` is intentionally compact. It carries the occurrence and rule IDs, operation, origin, occurrence time, an optional subscription run ID, and a source reference. It does not copy lifecycle snapshots, signal payloads, population context, or rule metadata into the sandbox context. Scripts read that immutable data through the execution-scoped `automationOccurrence` and `subscriptionRun` RyotQL tables.

Subscription dispatch records the occurrence, resolves matching rules, and starts one workflow per occurrence-rule pair. Workflow and run identities derive from that pair. The workflow prepares and persists the run, marks it running, executes the pinned script, then records the terminal result. Replays reuse the existing occurrence and run, and terminal runs do not execute again. These guarantees do not imply single-flight execution, so operations invoked by automations must remain idempotent.

RyotQL exposes only the occurrence and run bound to the current sandbox execution. A query cannot select another occurrence or run by ID because authorization wraps each execution-only table with the bound ID. These tables are unavailable through authenticated HTTP RyotQL and to plugin executions without the corresponding execution scope.

## Provider Imports

`provider-entity-import` identifies the entity, entity schema, provider, and provider external ID created by a provider operation. It is persisted as an occurrence before provider-import automation hooks run. These hooks execute directly with a user subject and an occurrence scope; they are not subscriptions and do not create a `subscriptionRun`.

Current-state queries cannot replace occurrence persistence. An update may be followed by another update before a replay reads it, a deleted row no longer exists, and current tables do not contain the original before snapshot, signal payload, population context, or provider-import identity. The immutable occurrence keeps every retry tied to the same historical input.
