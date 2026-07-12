# Domain-Neutral Operational Gate

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Generalize the production test-support surface used by the full-size operational measurement. Read
the overview, Phase 4 plan, parent PRD, and this task first.

The backend and contract may expose a generic, admin/test-gated plugin workflow load harness with
package/workflow/source inputs supplied by the e2e fixture, or move orchestration outward while
retaining only generic pressure/result primitives. The production test-support implementation must
not know Netflix, media population, media package slugs, or media workflow names.

Keep the exact two-concurrent-1,001-item workload, real infrastructure path, result assertions, and
standalone opt-in command unchanged from the user's perspective.

## Acceptance criteria

- [ ] Test-support contract and backend service contain no media source, package, workflow, or gate names
- [ ] Trusted test inputs identify the target package/workflow without creating a public execution API
- [ ] Run bookkeeping, packed workflow dispatch, pressure sampling, polling, and teardown remain available
- [ ] The operational e2e fixture owns all media-specific setup and expected behavior
- [ ] The unchanged operational test completes both 1,001-item imports and all packed workflows
- [ ] Database, workflow, sandbox, Redis, lock, and deadlock measurements remain recorded
- [ ] The test remains standalone and opt-in rather than joining the permanent standard suite command
- [ ] Contract/backend unit tests cover invalid targets and result polling
- [ ] The operational-test-support purity exception is removed

## User stories addressed

- User story 19
- User story 28
- User story 29
