# Ryot Agent Guidelines

## Project Architecture & Tools

- **Monorepo**: Uses `turbo`. All frontend commands must use `turbo`.
- **GitHub**: Use `gh` CLI; raw API only when `gh` doesn't support it.
- **Dependencies**: `cd <app> && bun add` (bun pins exact versions by default).
- **Bash paths**: Always quote with single quotes (e.g., `git add 'path/file.ts'`).
- **Linting and Formatting**: `bun turbo --filter=@ryot/app-backend check`.
- **Testing**: `bun turbo --filter=@ryot/app-backend test`.

## YAGNI

Do not add functionality, abstractions, or generalization the user has not explicitly requested. Push back on premature additions.

## Coding Standards

- **Type safety**: Prefer `z.infer` / `Schema.Schema.Type`, `Pick`, `Omit`, `ReturnType`, and indexed access types over parallel hand-written interfaces. The package's schema library (Zod for frontend packages, Effect Schema for `app-backend` and `@ryot/contract`) is the source of truth.
- **Pattern matching**: Prefer `match` from `ts-pattern` over `switch`.
- **Pattern discovery**: Before writing new code, launch an `explore` subagent to find existing patterns to replicate. `explore` subagents should be used only for discovery, not for any decision making. They should not create any files.
- **Comments**: Avoid unless strictly necessary.
- **Return types**: Omit unless inference is insufficient.
- **Field/variable ordering**: Ascending line length (shorter first). Exceptions for semantic grouping. Does not apply to imports or function parameters.

## Testing Philosophy

- Test app-owned behavior and branching, not library behavior.
- Keep assertions inline; extract duplicated setup, not test intent.
- Use assertion functions for test-only type narrowing instead of `if (...) { throw ... }` guard blocks. In Vitest suites, import `assert` from `vitest`; in `tests/`, use the local helpers from `tests/src/support/assertions.ts`.
- Avoid tests that only prove libraries or TypeScript work: Zod smoke parses, assigning then asserting the same value, status/data smoke checks, and `typeof`/`Array.isArray` passthroughs.

## Git Workflow

- Group related changes into logical commits. Messages focus on _why_, not _what_.
