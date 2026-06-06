# Integration Sink Workflow Orchestration

**Parent Plan:** [Effect Workflow Orchestration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Refactor sink integration runs so webhook-triggered integration processing is owned by the integration run workflow rather than a whole-run integration queue worker. A sink run should load and validate the integration, check disabled state and user-wide integration settings, mark the run started, parse the webhook payload through the sink adapter, record adapter-only failures when applicable, feed successful adapter results into the shared media import orchestration, finalize the import run, and apply integration finalization behavior.

This task may leave yank integration runs for the next task only if the temporary bridge is explicit and scoped. The sink path itself must not be a pass-through workflow. Any temporary bridge must be removed by the yank workflow task.

## Acceptance criteria

- [x] Sink integration runs execute through explicit workflow phases instead of one opaque integration-run queue worker
- [x] The workflow loads the integration and handles not-found, disabled integration, and user-wide integrations-disabled cases with existing product-compatible run failures
- [x] Sink adapter parsing is represented as a durable activity or bounded durable step
- [x] Adapter-only sink failures record import-run failures and fail the run consistently with existing behavior
- [x] Successful sink adapter results flow through the shared media import orchestration from the one-time media import task
- [x] Integration run finalization updates import-run and integration state consistently with existing behavior
- [x] Webhook routes still start the appropriate top-level integration workflow and return product-compatible responses
- [x] Tests cover successful sink processing, adapter-only sink failure, disabled integration, user-wide integrations-disabled behavior, and integration finalization

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 5
- User story 9
- User story 13
- User story 16
- User story 18
- User story 19
- User story 23
- User story 25
- User story 26
- User story 28
- User story 30
- User story 31
- User story 32
- User story 33
