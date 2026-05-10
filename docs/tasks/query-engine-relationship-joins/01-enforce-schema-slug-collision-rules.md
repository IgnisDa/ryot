# Enforce Schema Slug Collision Rules

**Parent Plan:** [Query Engine Relationship Joins](./README.md)

**Type:** AFK

**Status:** completed

## What to build

Implement the prerequisite from the parent PRD: user-created schema slugs must not conflict with built-in schema slugs in every schema namespace where user creation exists. This slice should make slug-based Query Engine APIs deterministic before relationship joins are introduced. Keep the behavior focused on public creation and resolution behavior; do not introduce relationship join support in this task.

## Acceptance criteria

- [x] User-created entity schema slugs that conflict with built-in entity schema slugs are rejected with a validation error.
- [x] User-created event schema slugs cannot create visible ambiguity with built-in or user-owned event schemas for the relevant entity schema scope.
- [x] Relationship schema slug resolution has a clear helper or loader behavior that returns exactly one visible schema for a user or throws a validation/not-found error.
- [x] If public relationship schema creation exists, it rejects user-created slugs that conflict with built-in relationship schema slugs or the same user's relationship schema slugs.
- [x] If public relationship schema creation does not exist, tests or code comments should not invent it; only add resolution behavior needed by later Query Engine tasks.
- [x] Existing schema creation behavior that is already correct remains covered by tests rather than being rewritten unnecessarily.
- [x] The implementation does not add relationship join request fields, runtime references, or SQL joins yet.
- [x] Tests cover the external validation behavior and any new resolver behavior.

## User stories addressed

- User story 33
- User story 34
- User story 40
