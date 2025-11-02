# Sandbox Boundary And Raw Engine Audit

**Parent Plan:** [Effect Workflow Orchestration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Audit and enforce the final sandbox workflow boundary after entity import, one-time imports, and integrations have been refactored. Raw workflow-engine execution of the sandbox workflow should exist only at deliberate top-level boundaries, such as direct user sandbox enqueue, independent after-create event trigger dispatch, or direct request/response operations that are not part of a parent workflow.

Remove or rewrite any remaining helper-level or worker-level raw sandbox workflow calls that hide parent-owned sandbox steps. Keep the sandbox execution workflow available as the reusable one-step durable primitive for standalone sandbox runs and parent workflow composition. Add regression coverage or static checks where practical so the pass-through pattern and hidden sandbox execution calls are not reintroduced.

## Acceptance criteria

- [ ] Raw sandbox workflow-engine execution remains only at deliberate top-level service boundaries documented by the parent PRD
- [ ] No queue worker calls the raw workflow engine to run sandbox work as part of a parent-owned process
- [ ] No shared helper used by imports, integrations, or entity import hides sandbox execution behind raw workflow-engine execution
- [ ] Direct user sandbox enqueue and polling remain product-compatible
- [ ] Independent after-create event trigger dispatch remains fire-and-forget and does not block event creation
- [ ] Entity search or other direct request/response sandbox operations remain valid only when they are not running inside a parent workflow
- [ ] The sandbox workflow remains a one-step durable primitive backed by bounded sandbox execution work
- [ ] Tests or static regression checks cover the allowed sandbox engine-call boundaries and fail if the old hidden-call pattern returns
- [ ] Tests or static regression checks cover that multi-step workflows are not simple pass-through durable queue wrappers

## User stories addressed

Reference by number from the parent PRD:

- User story 6
- User story 7
- User story 8
- User story 14
- User story 21
- User story 22
- User story 24
- User story 25
- User story 26
- User story 27
- User story 30
- User story 32
- User story 33
