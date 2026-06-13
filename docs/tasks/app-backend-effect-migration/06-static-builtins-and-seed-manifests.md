# Static Builtins And Seed Manifests

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Migrate static builtin definitions and startup seed manifests into the new backend. This includes builtin trackers, entity schemas, event schemas, relationship schemas, sandbox scripts, script-to-schema links, trigger links, and seed ordering. This slice seeds global builtin data but does not need full user bootstrap behavior yet.

The seed path should run after migrations and before server runtime behavior needs seeded rows. Keep validation Effect-native and avoid new backend imports from legacy utility packages.

## Acceptance criteria

- [x] Startup seed creates or updates builtin entity schemas and their event schemas
- [x] Startup seed creates or updates builtin sandbox scripts and provider associations
- [x] Startup seed creates or updates builtin trigger links and relationship schemas
- [x] Seed ordering handles dependencies between schemas, scripts, links, triggers, and relationships
- [x] Seed behavior is idempotent across repeated startups
- [x] Backend code for this slice does not depend on `@ryot/ts-utils`

## User stories addressed

Reference by number from the parent PRD:

- User story 17
- User story 18
- User story 63
