# Complete Third-Party Plugin Lifecycle E2E

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Complete the fake third-party-style plugin acceptance path after the underlying Phase 4 behavior is
stable. Read the overview, Phase 4 plan, parent PRD, and this task first.

One fixture package installed through the real plugin endpoint must exercise provider search, entity
import, event creation, an observable automation side effect, uninstall refusal while referenced,
cleanup, successful uninstall, and rejection of execution after uninstall without restarting the
backend. Keep the package domain-neutral so the test proves plugin infrastructure rather than media
or fitness behavior.

## Acceptance criteria

- [ ] The fixture is installed and visible through the real ingestion/loader path without restart
- [ ] Search executes fixture provider code and returns deterministic data
- [ ] Import populates a fixture entity through the generic provider/import path
- [ ] A fixture event is created and its declared automation produces an observable asserted effect
- [ ] Uninstall conflicts while entity or workflow references remain
- [ ] Cleanup uses owning public/test-support paths rather than direct table mutation
- [ ] Uninstall succeeds after references clear and the package disappears from active catalogs
- [ ] A historical script id cannot execute after uninstall
- [ ] Assertions cover each lifecycle stage rather than relying on status-only smoke checks
- [ ] The test is hermetic, offline, and leaves no active package or durable work behind

## User stories addressed

- User story 39
- User story 40
