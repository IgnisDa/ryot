# Cut Over the Universal Sandbox Runtime

**Parent Plan:** [Durable Sandbox - Phase 1](./README.md)

**Status:** done

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

- [x] Every persisted plugin and kernel definition dispatches through `SandboxScriptWorkflow`.
- [x] No production/E2E source still imports or declares the activity definition kind.
- [x] `SandboxSubmissionWorkflow` and obsolete whole-standard-script retry/queue paths are deleted.
- [x] Duplicate standard/workflow sandbox service entry points collapse to one minimal universal
      execution surface without changing public async job behavior.
- [x] One resource profile bounds local replay computation; durable waits hold no sandbox process or
      bridge session.
- [x] Workflow-only `durableCalls`, direct scratch output, and execution-mode manifest selectors are
      absent from SDK, compiler, plugin-kit, backend, plugins, and tests.
- [x] Authority checks, provider/script cache namespaces, exact root pins, first-observation child
      pins, cancellation, observability, and result polling remain covered and green.
- [x] Repository searches for removed symbols are recorded and every remaining match is justified or
      removed.
- [x] All affected package checks/tests and focused E2E pass after deletion with no compatibility
      branch restored.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 10
- User story 13

## Completion notes

- Collapsed HTTP/test-support enqueue and result polling onto `SandboxScriptWorkflow`, preserving
  active-script validation, user-bound job IDs, completed logs/timing/errors, and removal of internal
  harvest data from the public result.
- Deleted `SandboxSubmissionWorkflow`, `enqueueDurable`, the activity definition/export/compiler and
  manifest branches, the active-resolution queue wrapper, and the migrated activity fallback.
- Kept `SandboxExecutionQueue` only as the worker boundary used by `SandboxScriptWorkflow` for local
  replay execution. It is no longer a feature-workflow or top-level execution entry point.
- Replaced the workflow-only `durableCalls` authoring/transport name with the runner-internal
  `replayJournal` bootstrap and removed the test-only durable execution selector.
- Collapsed standard/workflow limits to one 30-second, 64-KiB context, 4-MiB terminal-output,
  1,000-host-call resource profile. Durable waits remain outside sandbox process and bridge lifetime.
- Updated runtime, plugin-kit, workflow, E2E-fix, and sandbox-audit guidance to describe only the
  universal runtime and selector-free cron shape.

## Repository search evidence

- `SandboxSubmissionWorkflow|enqueueDurable`: no matches in application, package, plugin, or E2E
  source after deletion. Historical plan/task documents retain decision-record references.
- `durableCalls|defineActivity|@ryot/sandbox-sdk/activity|ActivityManifest`: no matches in TypeScript,
  TSX, or package JSON source.
- `kind: "activity"`: no production plugin or E2E declarations remain. Remaining matches are the
  internal durable request protocol and unit tests for `replay.activity`, whose targets are ordinary
  `script` definitions composed through `SandboxScriptWorkflow`.
- `processSandboxExecution|makeSandboxExecutionResolutionActivity|performSandboxWorkflowActivity`:
  no backend source matches. `processSandboxExecutionQueue` remains only as the universal workflow's
  local replay worker boundary.
- `lot: "script"|lot: "workflow"`, `scratchOutput`, and standard/workflow limit selectors: no current
  application, SDK, compiler, plugin-kit, plugin, or E2E source matches.

## Verification

- Affected checks passed for `@ryot/sandbox-sdk`, `@ryot/sandbox-compiler`, `@ryot/plugin-kit`,
  `@ryot/contract`, `@ryot/app-backend`, and `@ryot/tests`.
- Affected package tests passed for `@ryot/sandbox-sdk`, `@ryot/sandbox-compiler`,
  `@ryot/plugin-kit`, `@ryot/media-plugin`, `@ryot/fitness-plugin`, and `@ryot/app-backend`.
- Focused E2E files passed individually: `kernel/sandbox/enqueue.test.ts`,
  `kernel/sandbox/durable-tracer.test.ts`, `kernel/sandbox/youtubei-tracer.test.ts`,
  `kernel/system/system-query-engine.test.ts`, `kernel/plugins/integration-ownership.test.ts`, and
  `kernel/integrations/plugin-provider-redaction.test.ts`.
- The opt-in sandbox benchmark and full E2E suite were not run; Task 15 owns final performance and
  phase-gate verification.
