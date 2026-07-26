# Cut Over the Universal Sandbox Runtime

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** todo

## What to build

Complete the hard cutover described by Phase 1 sections 7 and 10 after every production and E2E
script has migrated. Route plugin operations, providers, imports, integrations, automations,
scheduler boot/cron, generic operations, named workflows, kernel source zero, and test-support
execution through `SandboxScriptWorkflow` and the universal durable host dispatcher.

Delete the standard execution model rather than retaining compatibility: remove
`SandboxSubmissionWorkflow`, whole-script queue retries/wrappers that exist only for standard
execution, duplicate enqueue/execute-workflow service branches, standard/workflow resource profile
selection, workflow-only `durableCalls` authoring, activity definitions/references/compiler paths,
direct scratch output, and manifest selectors such as cron script/workflow lot. Preserve async job
contracts, authority, cache partitioning, script pinning, live-on-first-observation nested resolution,
cancellation, and result polling.

## Acceptance criteria

- [ ] Every persisted plugin and kernel definition dispatches through `SandboxScriptWorkflow`.
- [ ] No production/E2E source still imports or declares the activity definition kind.
- [ ] `SandboxSubmissionWorkflow` and obsolete whole-standard-script retry/queue paths are deleted.
- [ ] Duplicate standard/workflow sandbox service entry points collapse to one minimal universal
      execution surface without changing public async job behavior.
- [ ] One resource profile bounds local replay computation; durable waits hold no sandbox process or
      bridge session.
- [ ] Workflow-only `durableCalls`, direct scratch output, and execution-mode manifest selectors are
      absent from SDK, compiler, plugin-kit, backend, plugins, and tests.
- [ ] Authority checks, provider/script cache namespaces, exact root pins, first-observation child
      pins, cancellation, observability, and result polling remain covered and green.
- [ ] Repository searches for removed symbols are recorded and every remaining match is justified or
      removed.
- [ ] All affected package checks/tests and focused E2E pass after deletion with no compatibility
      branch restored.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 10
- User story 13
