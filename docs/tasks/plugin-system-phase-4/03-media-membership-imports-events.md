# Media Membership for Imports and Events

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** done

## What to build

Move import- and event-triggered library membership to the media package while preserving the
observable guarantees in "Media library ownership". Read the overview, Phase 4 plan, parent PRD,
and this task first.

Make provider-backed entity import generic: population remains kernel-owned, while media-owned
lifecycle composition ensures membership for media schemas before the successful import result is
observable. Event creation must likewise compose an awaited media-owned membership handler only for
media schemas. Replace media-specific import ownership output with a generic user-relationship
mutation shape that the kernel validates and applies without understanding `in-library`.

Do not move provider population, generic event persistence, import run accounting, artifact cleanup,
or failure recording into the plugin.

## Acceptance criteria

- [x] Generic entity import contains no library naming or media schema branching
- [x] Media entity import still returns only after required library membership is observable
- [x] Event creation still ensures membership for referenced global media entities before its awaited workflow completes
- [x] Fitness and unrelated fixture schemas do not receive media membership through either path
- [x] Generic import chunks express ownership behavior as domain-neutral user-relationship mutations
- [x] Media adapters preserve owned flag, merged ownership sources, and synchronization timestamp behavior
- [x] Failure propagation and per-item import failure stages remain behaviorally compatible
- [x] No transaction is held across sandbox or durable workflow execution
- [x] Existing media import/event assertions remain unchanged and focused exclusion tests are added
- [x] Temporary purity entries for import/event membership are removed

## User stories addressed

- User story 5
- User story 7
- User story 8
- User story 9
- User story 10
