# Fitness Plugin

Generic package, manifest, and sandbox authoring rules belong to the
[Plugin Kit](../../packages/plugin-kit/README.md).

## Automations

Post-write fitness automations receive compact source references rather than complete source records.
`automation.workout-created` and `automation.fitness-notification` load their immutable trigger with
`automationOccurrenceRecipe(automation.occurrenceId)` through
`executeRyotqlRecipe(host.executeRyotql, ...)`. An automation that needs subscription run metadata
should likewise use `automationRunRecipe(automation.runId)` through `executeRyotql` when a run ID is
present.

The occurrence preserves the trigger-time entity or signal snapshot. A separate RyotQL query reads
current state and may return values changed after that occurrence. Prefer explicit projections that
select only the fields required by the automation.
