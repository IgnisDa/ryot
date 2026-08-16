# Private Automations And Lifecycle

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** todo

## What to build

Complete private plugin lifecycle and remaining runtime surfaces. Follow the parent plan's Plugin Ingestion And Installation and Runtime Authority And Lifecycle decisions for event, entity, relationship, signal, and provider-import automations; installation user bootstrap; private cron; and capability enforcement.

Private instance boot declarations are rejected. User-bootstrap entries run once through the installation lifecycle owner with deterministic IDs and user authority. Private cron entries are discovered per ready, enabled installation and execute with owner authority. Automation bindings are evaluated only from the affected data owner's effective registry.

## Acceptance criteria

- [ ] Private plugin ingestion rejects every instance boot declaration with a clear validation error.
- [ ] A private installation enters installing health, runs declared user-bootstrap entries once in deterministic order with owner authority, and becomes ready only after success.
- [ ] Terminal bootstrap failure produces failed health and a safe diagnostic without exposing sandbox internals or activating runtime surfaces.
- [ ] Retried installation workflows do not duplicate bootstrap effects, and package updates do not dispatch installation bootstrap.
- [ ] Private cron discovery creates one schedule per ready, enabled installation and uses deterministic execution IDs containing installation identity and occurrence.
- [ ] Private cron execution always uses installation-owner authority; system cron and boot behavior remains system-authority and once per instance.
- [ ] Event, entity, relationship, signal, and provider-import automations resolve only from the data owner's ready, enabled effective registry.
- [ ] Capability declarations cannot bypass host-function authority checks or grant a private plugin system-only behavior.
- [ ] Disablement prevents new bootstrap-independent automation and cron dispatch while preserving already pinned workflow semantics.
- [ ] Validation, installation workflow, scheduler, automation policy, durable dispatch, and host capability tests cover authority and idempotency.

## User stories addressed

- User story 29
- User story 31
- User story 32
- User story 33
- User story 40

## Implementor Notes

Use one durable owner for installation bootstrap. Parent workflows may orchestrate entries, but activities must not start workflows or durable queues.
