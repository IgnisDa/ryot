# Tests Guidelines

> Inherits from root `AGENTS.md` for testing philosophy and anti-patterns. Rules below are additive.

## Scope

This package contains end-to-end and integration-style tests for Ryot.

## Running Tests

Run `bun run typecheck`, `bun run test`, and `bun run lint` in `tests` after changes.

## Conventions

- Prefer shared helpers in `tests/src/fixtures` for repeated auth setup, API setup, and test data builders.
- Favor fixture files with clear ownership (`auth`, `trackers`, `entity-schemas`, `saved-views`, `query-engine`) over generic catch-all helpers.
- Keep `tests/src/test-support` for shared test suites only, not general-purpose fixtures.
- Do not refactor `tests/src/seed-script.ts` as part of test fixture cleanup unless explicitly requested.
