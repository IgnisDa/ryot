# Media-Monitoring Notification Removal

**Parent Plan:** [Database-Driven Automations, Signals, and Subscriptions](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] Media monitoring contains no direct notification workflow calls and no message
      construction; a test pins this
- [ ] Every detected change in the PRD's sole-producers table is covered by a parity test through
      the signal path
- [ ] Every active catalog signal schema has an enabled producer
- [ ] The documentation cutover is complete; no sibling document describes configured events or
      the trigger model as current behavior

## User stories addressed

- User story 33
- User story 34
