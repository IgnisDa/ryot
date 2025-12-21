# Problem Statement

The app backend uses Effect Workflow for background work, but the current workflow definitions do not orchestrate business processes. Each workflow registers a `toLayer` handler that only enqueues one durable queue item and waits for that worker to finish. The durable queue worker then performs the entire business process, including multi-phase imports, entity population, integration runs, and sandbox execution.

This creates a structural mismatch with Effect Workflow. The workflow engine persists and resumes execution at durable primitives such as activities, durable queues, durable deferred signals, durable sleeps, and child workflow execution. When all business logic lives inside one queue worker, the workflow has no visibility into the intermediate phases, no durable step graph, no durable retry semantics per phase, no parent-child workflow linkage, and no clear place for compensation or external waits.

The most visible issue is sandbox execution. Entity population, entity resolution, entity search, and some integration adapters call the sandbox workflow through the raw workflow engine from helpers or queue workers. Those calls may wait for sandbox results, but they do not run as part of the parent workflow's durable execution context. The parent workflow only sees one opaque queue item, so sandbox execution is hidden from parent workflow status, interruption, and resumption.

The project is greenfield and is not deployed to real users. There is no requirement to preserve old pass-through workflow behavior, old workflow execution compatibility, old in-flight jobs, old queue names, or old workflow names. The implementation should replace the anti-pattern directly with the target architecture.

## Solution

Refactor backend workflow usage so workflows own orchestration and durable queue workers own bounded units of work. The `toLayer` handler for each meaningful workflow should contain the business process graph: durable activities for side effects, durable queue calls for worker-isolated tasks, workflow execution for child workflows, and durable deferred or durable clock primitives when a process must wait for external input or time.

The sandbox execution workflow remains a reusable durable primitive for sandbox runs. It may stay as a one-step workflow backed by a durable queue because standalone sandbox runs are user-facing, pollable, resource-limited jobs. However, when sandbox execution is part of entity import, import processing, or integration processing, parent workflows should call the sandbox workflow from inside their own workflow body, or call the sandbox execution durable queue directly from inside the workflow body. Raw workflow-engine calls from helpers and queue workers should not be used for parent-owned steps.

Entity import becomes a real workflow that checks for existing populated global entities, fetches details through sandbox execution, validates returned properties, writes the global entity, writes related placeholder entities and relationships, and adds the primary entity to the user's library through durable steps. The worker that currently owns the whole entity import should either disappear or shrink to one bounded operation if worker isolation is still needed for a specific step.

One-time imports and integration runs become durable workflows that expose the existing logical phases directly in workflow orchestration. Adapter loading, input failure recording, entity resolution, entity population, event and collection writes, progress updates, source payload cleanup, run finalization, and integration finalization should be represented as named durable steps. Shared media import phases should be extracted behind a stable workflow-friendly interface so one-time import runs and integration runs reuse the same orchestration instead of duplicating hidden queue-worker pipelines.

The implementation should favor direct replacement over compatibility. Existing persisted workflow execution state can be discarded. Existing internal workflow and queue names may be changed if clearer names help the target design. Public API behavior should remain product-compatible where practical: users can still enqueue sandbox runs, start entity imports, start one-time imports, trigger integration runs, and poll supported run results. Internal step structure, workflow names, and worker boundaries are free to change.

## User Stories

1. As a backend maintainer, I want workflows to contain orchestration logic, so that Effect Workflow is used for durable process coordination rather than as a queue wrapper.
2. As a backend maintainer, I want queue workers to perform bounded units of work, so that one worker does not hide an entire business process from the workflow engine.
3. As a backend maintainer, I want entity import phases to be visible as durable workflow steps, so that sandbox details, validation, persistence, relationship writes, and library membership can be reasoned about independently.
4. As a backend maintainer, I want import run phases to be visible as durable workflow steps, so that adapter load, entity resolution, entity population, event writes, and finalization are not hidden inside one queue worker.
5. As a backend maintainer, I want integration run phases to be visible as durable workflow steps, so that integration validation, source fetch, media import, and integration finalization are not hidden inside one queue worker.
6. As a backend maintainer, I want sandbox execution inside parent processes to be called from workflow bodies, so that the parent workflow has durable visibility into sandbox work.
7. As a backend maintainer, I want raw workflow-engine sandbox calls removed from parent-owned helpers, so that helpers do not bypass workflow composition.
8. As a backend maintainer, I want standalone sandbox execution to remain available as a durable pollable job, so that users and event triggers can still run scripts independently.
9. As a backend maintainer, I want repository writes inside workflow bodies wrapped in durable activities, so that replay after suspension does not duplicate side effects.
10. As a backend maintainer, I want workflow activity names to be deliberate and stable, so that durable step identity is understandable and not accidentally duplicated.
11. As a backend maintainer, I want long-running or resource-limited work represented by durable queues, so that concurrency limits and worker isolation remain explicit.
12. As a backend maintainer, I want reusable multi-step work represented as child workflow execution, so that parent workflows can compose sub-processes with durable parent-child linkage.
13. As a backend maintainer, I want pure deterministic transforms to stay inside workflow bodies when safe, so that the code is not over-split into unnecessary activities.
14. As a backend maintainer, I want provider-specific HTTP and sandbox driver behavior to remain in sandbox scripts or adapter code, so that workflow orchestration does not leak provider details into unrelated modules.
15. As an import user, I want one-time import runs to keep reporting status, progress, item counts, and failures, so that I can understand import outcomes after the refactor.
16. As an import user, I want item-level failures to keep being recorded even when other items can continue, so that one bad source row does not fail a whole import unnecessarily.
17. As an import user, I want source-fetch or credential failures to fail the whole import run clearly, so that catastrophic failures are not hidden as item failures.
18. As an integration user, I want scheduled and webhook integration runs to continue writing imported events and ownership state, so that integrations keep their product behavior.
19. As an integration user, I want integration runs to still update last successful completion and continuous error disabling behavior, so that integration health behavior remains intact.
20. As an entity import user, I want importing a provider-backed entity to still populate global entity details, related placeholders, relationships, and library membership, so that entity import behavior is unchanged from my perspective.
21. As a sandbox user, I want manually enqueued sandbox runs to remain pollable, so that direct script testing still works.
22. As a workflow operator, I want workflow failures to identify the failed logical step, so that debugging does not require reading one large worker pipeline.
23. As a workflow operator, I want durable queue concurrency retained for sandbox execution and other expensive work, so that refactoring orchestration does not remove operational backpressure.
24. As a workflow operator, I want workflow interruption and resume semantics to include child sandbox executions, so that parent processes do not continue to treat sandbox as an opaque external call.
25. As a workflow operator, I want workflow polling to reflect suspended parent workflows while child work is pending, so that pending state is truthful.
26. As a developer, I want no backward-compatibility shims for old workflow state, so that the greenfield codebase reaches the target architecture faster.
27. As a developer, I want obsolete pass-through queues and workers removed when replaced, so that the codebase does not keep two background execution models for the same process.
28. As a developer, I want imports and integrations to share workflow-friendly media import orchestration, so that fixes to resolution, population, and writes apply to both paths.
29. As a developer, I want source payload cleanup represented as a durable finalization step, so that temporary sensitive payloads are not retained after import processing.
30. As a developer, I want DB transactions not to cross durable workflow boundaries, sandbox execution, sleeps, or fan-out work, so that workflow suspension does not hold database transactions open.
31. As a developer, I want service-layer write paths reused from workflow steps, so that imports, integrations, and background jobs still follow module ownership rules.
32. As a developer, I want tests to pin durable orchestration behavior at module boundaries, so that future changes do not reintroduce pass-through workflows.
33. As a future implementation agent, I want this PRD to document all architecture decisions, so that implementation does not depend on prior conversation context.

## Implementation Decisions

- The project is greenfield for this change. Do not preserve old in-flight workflow executions, old queue payload compatibility, old internal workflow names, old durable queue names, or old pass-through behavior.
- The target architecture is direct replacement, not incremental compatibility. Remove pass-through workflow definitions and obsolete whole-pipeline workers after their behavior has moved into workflow orchestration.
- Workflows that represent multi-step domain processes must have `toLayer` handlers that run the process graph directly with durable workflow primitives.
- A workflow `toLayer` handler must not consist solely of one durable queue process call unless the workflow is intentionally a one-step durable job facade.
- Durable queues remain appropriate for bounded work that needs worker isolation, resource backpressure, or concurrency control.
- Activities are the default wrapper for side-effecting steps that must not repeat on workflow replay, including status updates, repository writes, loading stored payloads, deleting stored payloads, recording failures, and finalizing run records.
- Pure deterministic calculations may stay inline in workflow bodies when replaying them is harmless.
- Workflow execution from inside another workflow is the child-workflow composition mechanism available in the current package version. Do not introduce a nonexistent `ChildWorkflow` API unless the package is upgraded and verified first.
- Raw workflow-engine execution is allowed at service boundaries that start a top-level workflow, such as enqueueing a user-facing sandbox run or starting an import run.
- Raw workflow-engine execution must not be used from helpers or queue workers for steps that are part of an already-running parent workflow.
- The sandbox execution workflow remains as a reusable durable primitive for standalone sandbox runs, event trigger runs, and parent workflow composition.
- The sandbox execution durable queue remains responsible for loading the sandbox script and running the script through the sandbox runtime with bounded concurrency.
- Parent workflows may either call the sandbox execution workflow from inside the workflow body or call the sandbox execution durable queue directly from inside the workflow body.
- Use sandbox workflow execution from parent workflows when a separate child workflow identity, polling, interruption linkage, and reusable sandbox abstraction are valuable.
- Use direct sandbox durable queue processing from parent workflows when the sandbox step is purely internal to the parent and does not need a separately pollable workflow identity.
- Entity population helpers should be split into workflow-friendly phases rather than owning raw workflow-engine calls.
- Entity population should expose operations for checking existing global entities, locating script/schema metadata, decoding sandbox details output, validating entity properties, writing the primary global entity, writing related placeholder entities, writing relationships, and ensuring library membership.
- Entity import orchestration should live in the entity import workflow, not in an entity import queue worker.
- Entity import should short-circuit when a matching populated global entity already exists, while still ensuring user library membership.
- Entity import should run the details sandbox driver as a durable child step when population is required.
- Entity import should validate details output and schema properties after sandbox completion and before persistence.
- Entity import should write related placeholder entities and relationship rows through durable activities or bounded child steps that cannot duplicate side effects on replay.
- Entity import should add the imported primary entity to the user's library through the collections service as a durable step.
- Entity resolution for import refs should become workflow-owned durable work instead of a helper-level raw sandbox workflow call.
- Entity search may remain a top-level service-initiated sandbox execution when it is a direct request/response operation outside a parent workflow. If search is used inside an import or integration workflow, the parent workflow should own that sandbox step.
- The one-time import workflow should replace the current whole-run import queue worker with explicit orchestration.
- The one-time import workflow should load the import run, mark it running, load source payloads or temporary files, call the source adapter, record adapter failures, update item totals, run media resolution, run media population, write media events and collections, clean source payloads, clean temporary files when applicable, and finalize the run.
- Source adapter loading should be an activity when it is bounded and safe to retry according to source semantics.
- Source adapter loading may be a durable queue step when it performs expensive file parsing, external API calls, or work that should be isolated from workflow execution fibers.
- Source adapter load failures that represent catastrophic source-fetch or credential failures should fail the run through a durable failure-recording step.
- Adapter row-level failures should be recorded as item failures and should not automatically fail the whole run.
- Media import orchestration should become a shared workflow-friendly module used by both one-time imports and integration runs.
- The shared media import orchestration should expose phases for adapter result normalization, failure recording, progress reporting, entity resolution, entity population, event and collection writes, and final counters.
- Media entity resolution should call sandbox resolve drivers as durable child steps or durable queue steps.
- Media entity population should call entity import or entity population workflow steps rather than helper-level raw workflow-engine calls.
- Media event and collection writes should continue using owning module services rather than writing other modules' tables directly.
- Media writes should run in bounded chunks or per-item durable activities where replay safety and failure reporting require it.
- Progress updates should be durable activities and should remain throttled by item count or phase boundaries to avoid excessive workflow history.
- Integration run orchestration should live in the integration run workflow, not in an integration run queue worker.
- Integration runs should load and validate the integration, check disabled state and user-wide integration disable settings, mark the run started, execute sink or yank source adaptation, run shared media import orchestration, finalize the import run, update integration last-finished state on success, and apply continuous-error disabling logic.
- Integration sink adapters may produce adapter results synchronously and pass them into shared media import orchestration.
- Integration yank adapters that fetch external data should be modeled as durable activities, durable queue steps, or sandbox child steps depending on the provider.
- YouTube Music history fetching should no longer call the sandbox workflow through the raw workflow engine from adapter code when it is part of an integration run. The integration workflow should own that sandbox history step.
- Event after-create trigger dispatch may continue to start standalone sandbox executions as fire-and-forget top-level workflows because those trigger runs are intentionally independent of an existing parent workflow.
- Direct user sandbox enqueue should continue to start a top-level sandbox workflow and return a pollable job id.
- Workflow activity names, durable queue names, durable deferred names, and generated execution ids are durable identity. Choose clear deterministic names during implementation and avoid reusing the same activity name for different semantics within one workflow.
- Looping workflow steps should include stable item identity in child workflow execution ids or queue idempotency keys.
- Do not hold a database transaction across sandbox execution, durable queue processing, workflow execution, durable sleep, durable deferred wait, or fan-out work.
- Expected workflow failures should use typed workflow error schemas that preserve user-visible failure messages without widening every defect into domain failures.
- Defects should remain defects unless there is a deliberate product error to surface.
- No app database schema changes are required by this PRD unless implementation discovers that existing import run or integration run state cannot represent the same product behavior.
- No public HTTP API contract changes are required by this PRD. Route behavior for starting and polling sandbox runs, entity imports, import runs, and integration runs should remain product-compatible.
- Internal service interfaces may change freely to support workflow-owned orchestration.
- Existing helper APIs that currently hide raw sandbox workflow execution should be replaced with lower-level operations that can be composed by workflows.
- Existing pass-through whole-pipeline durable queues should be removed if no longer needed after workflow orchestration owns their process.
- Existing durable queues may be retained if they now represent a bounded step with clear worker isolation.
- The reference audible workflow is the local pattern authority for this refactor: use activities for side effects, durable queue processing for sandbox-like worker calls, workflow execution for child workflows, durable deferred signals for external waits, durable clock sleeps for durable timeouts, and compensation around persisted intermediate results when needed.

## Testing Decisions

- Tests should verify externally observable behavior and durable process boundaries, not private implementation details.
- Do not write tests that only prove Effect Workflow library behavior, TypeScript typing, or schema smoke parsing.
- Add workflow-focused tests that fail if multi-step domain workflows regress to one pass-through durable queue process call.
- Entity import tests should verify that a successful import still populates the primary entity, writes related placeholder entities and relationships, sets populated timestamps correctly, and ensures user library membership.
- Entity import tests should verify that sandbox details failures produce the expected failed import result.
- Entity import tests should verify that an already populated global entity short-circuits sandbox details execution while still ensuring library membership.
- Import run tests should verify phase outcomes through run status, progress, item counts, item failures, populated entities, written events, written collections, and source payload cleanup.
- Import run tests should cover catastrophic adapter failure separately from adapter row-level failures.
- Integration run tests should verify disabled integration handling, user-wide integrations-disabled handling, successful sink processing, successful yank processing where practical, finalization, and continuous-error disabling behavior.
- YouTube Music integration tests should verify that history sandbox execution is owned by integration workflow orchestration rather than hidden behind a raw engine call in adapter code.
- Sandbox service tests should continue verifying direct enqueue and polling behavior for standalone sandbox runs.
- Event trigger tests should continue verifying that after-create triggers dispatch standalone sandbox runs without blocking event creation.
- Shared media import tests should focus on phase behavior and persisted results rather than whether a phase is implemented as an activity, durable queue, or child workflow.
- Add pure helper tests for any extracted entity population or media import planning functions when those helpers contain meaningful branching.
- Use existing backend test patterns with Vitest and Effect test layers.
- Use fake workflow engines only for service-boundary tests that assert top-level workflow enqueue behavior.
- Prefer workflow layer tests for workflow body behavior so child workflow execution, activity replay safety, and durable queue calls are represented at the correct abstraction level.
- Prior art for workflow composition tests and patterns is the audible reference workflow and its associated activity/service style.
- Prior art for import behavior tests is the current imports, entity import, and integration test coverage around run records, failures, and persisted domain data.
- The final verification command for backend code changes should include the app-backend check command used by this repository.

## Out of Scope

- Preserving old in-flight workflow executions.
- Preserving old internal workflow names or durable queue names.
- Adding compatibility adapters for old pass-through workflow state.
- Introducing BullMQ or any non-Effect background queue for these flows.
- Redesigning public import, integration, entity import, or sandbox HTTP APIs.
- Changing provider-specific sandbox script behavior unless required to support workflow-owned orchestration.
- Reworking unrelated event trigger semantics beyond keeping standalone trigger dispatch working.
- Adding user confirmation, durable deferred waits, or saga compensation to imports unless a specific phase already needs it.
- Adding new database tables or columns solely for workflow migration.
- Upgrading `@effect/workflow` solely to access a differently named child workflow API.
- Preserving helper APIs that exist only to hide raw workflow-engine sandbox calls.

## Further Notes

- The most important design rule is ownership of orchestration. If a parent process conceptually contains a sandbox step, the parent workflow body should contain that step.
- A one-step workflow is acceptable only when the product concept is genuinely one durable job with a pollable result or when the workflow is intentionally a facade around one resource-limited worker action.
- The sandbox workflow is the main acceptable one-step workflow in this plan because it is independently user-facing and operationally useful.
- The import and integration workflows are not acceptable one-step workflows because they have explicit phases, progress, partial failures, and parent-owned sandbox calls.
- Implementation should remove obsolete workers and helpers as soon as their behavior moves into workflows. Do not leave dead pass-through wrappers for later unless a task is explicitly scoped to keep a temporary bridge.
- The final cleanup task generated from this PRD should use the codebase-cleanup skill and specifically look for stale pass-through workflows, raw workflow-engine sandbox calls inside helpers/workers, obsolete queue payloads, duplicated phase code, and tests that mock implementation details instead of behavior.

---

## Tasks

**Overall Progress:** 1 of 7 tasks completed

**Current Task:** [Task 02](./02-one-time-media-import-workflow-orchestration.md) (todo)

### Task List

| #   | Task                                                                                                         | Type | Status |
| --- | ------------------------------------------------------------------------------------------------------------ | ---- | ------ |
| 01  | [Entity Import Workflow Orchestration](./01-entity-import-workflow-orchestration.md)                         | AFK  | done   |
| 02  | [One-Time Media Import Workflow Orchestration](./02-one-time-media-import-workflow-orchestration.md)         | AFK  | todo   |
| 03  | [One-Time Non-Media Import Workflow Orchestration](./03-one-time-non-media-import-workflow-orchestration.md) | AFK  | todo   |
| 04  | [Integration Sink Workflow Orchestration](./04-integration-sink-workflow-orchestration.md)                   | AFK  | todo   |
| 05  | [Integration Yank Workflow Orchestration](./05-integration-yank-workflow-orchestration.md)                   | AFK  | todo   |
| 06  | [Sandbox Boundary And Raw Engine Audit](./06-sandbox-boundary-and-raw-engine-audit.md)                       | AFK  | todo   |
| 07  | [Codebase Cleanup](./07-codebase-cleanup.md)                                                                 | AFK  | todo   |
