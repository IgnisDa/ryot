# Ryot Agent Guidelines

## Project Architecture & Tools

- **Monorepo**: Uses `turbo`. All frontend commands must use `turbo`.
- **GitHub**: Use `gh` CLI; raw API only when `gh` doesn't support it.
- **Documentation lookup**: Use the `find-docs` skill to verify against current docs before answering or coding.
- **Dependencies**: `cd <app> && bun add -E` (exact versions, no ranges).
- **Bash paths**: Always quote with single quotes (e.g., `git add 'path/file.ts'`).
- **Linting**: `oxlint` with `--fix` to auto-fix. Example: `bun turbo --filter=@ryot/app-backend lint`.
- **Formatting**: `oxfmt` to format files. Example: `npx oxfmt .` (writes), `npx oxfmt --check .` (checks only).

## YAGNI

Do not add functionality, abstractions, or generalization the user has not explicitly requested. Push back on premature additions.

## Coding Standards

- **Type safety**: Prefer `z.infer`, `Pick`, `Omit`, `ReturnType`, and indexed access types over parallel hand-written interfaces. Zod schemas are the source of truth.
- **Pattern matching**: Prefer `match` from `ts-pattern` over `switch`.
- **Pattern discovery**: Before writing new code, launch an `explore` subagent to find existing patterns to replicate. `explore` subagents should be used only for discovery, not for any decision making. They should not create any files.
- **Dates**: Prefer `dayjs` from `@ryot/ts-utils`. Avoid manual `Date` handling.
- **Comments**: Avoid unless strictly necessary.
- **File size**: Keep files below 500 lines. Split if exceeded.
- **Return types**: Omit unless inference is insufficient.
- **Field/variable ordering**: Ascending line length (shorter first). Exceptions for semantic grouping. Does not apply to imports or function parameters.

```typescript
const notification = {
	color: "red",
	title: "Invalid action",
	message: "Changing preferences is disabled for demo users",
};
```

## Testing Philosophy

- Test app-owned behavior and branching, not library behavior.
- Keep assertions inline; extract duplicated setup, not test intent.
- Anti-patterns to avoid:
  - **Zod smoke tests**: `schema.safeParse(validInput)` asserting `success === true` only proves Zod works.
  - **TypeScript-redundant tests**: asserting `object.field === "the value you just assigned"`. Giveaway: `X as string` casts to suppress TS errors.
  - **Smoke-only integration assertions**: `expect(status).toBe(200)` + `expect(data).toBeDefined()` without verifying content.
  - **Trivial library passthrough**: `typeof x === "function"` or `Array.isArray(x)` without checking behavior.

## Git Workflow

When creating commits:

1. Read all dirty changes
2. Group related changes into logical commits
3. Write verbose messages focused on _why_, not _what_
