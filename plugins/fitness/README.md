# Fitness Plugin

Generic package, manifest, and sandbox authoring rules belong to the
[Plugin Kit](../../packages/plugin-kit/README.md).

## Automations

`fitness.workout-created` is an async after hook for API-created workouts. The manifest's
causation filter excludes imports and other sources. Its script reads the immutable entity snapshot
from `automation.payload` and emits `workout.created`.

`fitness.notification` is the signal's stable notification hook. It reads the inline signal payload
and formats the plugin-owned message. Notification delivery has one attempt and no automatic retry
of uncertain external outcomes. Neither script queries execution records through RyotQL.
