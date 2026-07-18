# Race-Safe Resolution and Uninstall Fencing

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** done

## What to build

Establish the authoritative snapshot and workflow-reference semantics required before GC. Read the
overview, Phase 4 plan, parent PRD, and this task first.

Capture one immutable loader snapshot per logical provider/script/binding resolution. Preserve active
entrypoint resolution versus exact replay pinning. Add an uninstall fence that prevents new dispatch
while checking entity/provider references and nonterminal plugin workflow pins. Uninstall conflicts
when references exist; refusal restores ordinary dispatch without changing the active snapshot.

## Acceptance criteria

- [x] Each logical resolver operation derives all manifest, provider, binding, and active script decisions from one snapshot
- [x] Immutable content-hash rows allow a complete old or complete new result around replacement
- [x] New entrypoint dispatch still resolves active code while workflow replay uses its exact pin
- [x] Uninstall fences new plugin entrypoint/workflow dispatch before reference inspection
- [x] Running and suspended workflow pins cause a typed uninstall conflict
- [x] Entity, provider, and active-plugin definition references retain existing refusal behavior
- [x] A refused uninstall reopens dispatch and leaves registry/database activation unchanged
- [x] A successful uninstall publishes invalidation only after durable deactivation
- [x] Controlled concurrency tests cover swap during resolution, dispatch during uninstall, refusal, retry, and success
- [x] The resulting liveness/reference interface is reusable by task 14

## User stories addressed

- User story 34
- User story 35
- User story 36
- User story 37
- User story 38
