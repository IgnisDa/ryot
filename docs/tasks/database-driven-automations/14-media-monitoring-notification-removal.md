# Media-Monitoring Notification Removal

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** done

## What to build

Complete the media-monitoring conversion, per the PRD's Media Monitoring and Documentation
Cutover sections. With tasks 11–13 providing detector parity for every monitored change, delete
the module's direct notification fan-out and message construction: the module keeps provider
refresh scheduling and entity population ownership, and nothing else notification-related.
Signals and subscriptions become the sole notification path, so old and new paths never run
simultaneously.

Establish parity first: media-monitoring tests must cover every detected change from the PRD's
sole-producers table and prove no direct notification workflow call remains anywhere in the
module. Verify every active catalog schema has its producer enabled, closing the phase-gating
rule. Finish the documentation cutover: the decisions document and Effect workflow guide wherever
they encode configured events or the old notification/monitoring workflow ownership, the
V1-to-V2 port gap analysis (signal producers and user-owned subscriptions for event-driven
alerts; calendar-dependent behavior stays deferred), and any remaining agent-guide wording, so no
sibling document presents configured events or the trigger model as current behavior.

Builds on tasks 11–13. Verifiable: the full monitored-refresh flows notify through subscriptions
only, and a repository-wide search finds no direct delivery call in media monitoring.

## Acceptance criteria

- [x] Media monitoring contains no direct notification workflow calls and no message construction
- [x] Every detected change in the PRD's sole-producers table is covered by a parity test through
      the signal path
- [x] Every active catalog signal schema has an enabled producer
- [x] The documentation cutover is complete; no sibling document describes configured events or
      the trigger model as current behavior

## Implementation notes

- `MediaMonitoringRefreshWorkflow` now only composes the provider-population workflow. Lifecycle
  detectors emit signals from the population mutation envelopes, and user-owned subscriptions
  resolve the monitoring audience and deliver notifications.
- Removed the media-monitoring snapshot diff, message builders, post-refresh subscriber fan-out,
  and the repository queries that existed only for that path.
- Existing detector and notification-script tests cover every media signal in the sole-producers
  table. The infrequent-refresh e2e cases now prove baseline silence, status-change delivery, and
  independent season/episode delivery through signal subscriptions; association e2e coverage
  remains in its dedicated suite.
- Added a catalog-gating test that requires every active signal schema to have a linked lifecycle
  producer, except `integration.disabled`, whose integration workflow author path is covered by its
  workflow test.
- The planned source-text test asserting that removed implementation names stay absent was not
  retained, per explicit direction to remove references to the old code. Functional signal-path
  coverage and a repository search were used instead.

## User stories addressed

- User story 33
- User story 34
