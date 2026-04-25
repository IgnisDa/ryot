# Sandbox Runtime And Direct Runs

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Migrate the Deno sandbox runtime, process lifecycle, local bridge, Redis-backed sessions/cache, host functions, sandbox script creation, direct sandbox run enqueueing, and sandbox result polling using Effect services and workflow-compatible primitives. Avoid BullMQ in the new implementation.

This slice should make direct sandbox E2E tests pass and provide the substrate for provider search/import and event triggers.

## Acceptance criteria

- [x] Sandbox service starts and stops through Effect resource management
- [x] Deno runner, package cache, process pool, and bridge behavior are migrated or replaced with equivalent hardened behavior
- [x] Host functions use Effect services and typed errors
- [x] Authenticated users can create sandbox scripts
- [x] Authenticated users can run scripts and poll results without BullMQ
- [x] Sandbox E2E tests pass through the Effect client

## Implementation note

Direct sandbox runs now execute through Effect Workflow plus a durable sandbox queue. Poll ownership is enforced with a stateless signed `jobId`, so there is no dedicated `sandbox_run` app table in the migrated backend.

## User stories addressed

Reference by number from the parent PRD:

- User story 27
- User story 28
- User story 36
- User story 59
