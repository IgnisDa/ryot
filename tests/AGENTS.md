# Tests Guidelines

## Scope

This package contains end-to-end and integration-style tests for Ryot.

## Testing

- Run `bun run typecheck`, `bun test`, and `bun run lint` in `tests` after changes.
- Prefer shared helpers in `tests/src/fixtures` for repeated auth setup, API setup, and test data builders.
- Keep test definitions and assertions inline; extract duplicated setup, not test intent.
- Favor fixture files with clear ownership like `auth`, `trackers`, `entity-schemas`, `saved-views`, and `view-runtime` over generic catch-all helpers.
- Keep `tests/src/test-support` for shared test suites only, not general-purpose fixtures.
- Do not refactor `tests/src/seed-script.ts` as part of test fixture cleanup unless explicitly requested.
