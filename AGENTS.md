# Ryot Agent Guidelines

## Project Architecture & Tools

- **Monorepo**: Uses `turbo`. All frontend commands must use `turbo`.
- **GitHub**: Use `gh` CLI; raw API only when `gh` doesn't support it.
- **Documentation lookup**: For questions or changes involving a specific library, framework, SDK, CLI tool, or cloud service, use the `find-docs` skill and verify against current documentation before answering or coding.
- **Dependencies**: `cd <app> && bun add -E` (exact versions, no ranges).
- **Bash paths**: Always quote with single quotes (e.g., `git add 'path/file.ts'`).
- **Linting**: Linting uses `biome`. Prefer using `--write` to auto-fix issues. For example: `bun turbo --filter=@ryot/app-backend lint -- --write`.

## YAGNI

Apply YAGNI (You Ain't Gonna Need It) strictly. Do not add functionality, abstractions, configuration options, or generalization that the user has not explicitly requested. If a proposed change introduces something that won't be immediately used, push back and explain why it is premature.

## Coding Standards

- **Type safety**: Prefer `z.infer`, `Pick`, `Omit`, `ReturnType`, and indexed access types over parallel hand-written interfaces. Treat zod schemas as the source of truth for runtime types.
- **Pattern matching**: Prefer `match` from `ts-pattern` over `switch` statements for type-safe pattern matching.
- **Pattern discovery**: Before writing new code, launch an `explore` subagent to find existing patterns to replicate. `explore` subagents should be used only for discovery, not for any decision making. They should not create any files.
- **Dates**: Prefer `dayjs` from `@ryot/ts-utils` for date parsing, formatting, comparison, and arithmetic. Avoid manual `Date` handling unless necessary.
- **Comments**: Avoid unless strictly necessary. Prefer self-documenting code.
- **File size**: Keep files below 500 lines. Split if exceeded.
- **Return types**: Omit explicit return types unless inference is insufficient.
- **Field/variable ordering**: Order by ascending line length (shorter first). Exceptions for semantic grouping. Does not apply to imports or function parameters.

```typescript
const notification = {
    color: "red",
    title: "Invalid action",
    message: "Changing preferences is disabled for demo users",
};
```

## Testing Philosophy

- Prefer tests for app-owned behavior and branching. Avoid tests that only restate library behavior unless the integration itself is the risk.
- Keep test assertions inline; extract duplicated setup, not test intent.
- Anti-patterns to avoid:
  - **"accepts valid values" Zod tests**: calling `schema.safeParse(validInput)` and asserting `success === true` only proves Zod's parser works, not app logic. Delete these.
  - **TypeScript-redundant tests**: creating a typed object and asserting `object.field === "the value you just assigned"` adds no value — TypeScript catches invalid assignments at compile time. A dead giveaway is an `X as string` or `X as unknown as Y` cast used to suppress a TypeScript error that would expose the comparison as always-true or always-false.
  - **Smoke-only integration assertions**: `expect(response.status).toBe(200)` + `expect(data?.data).toBeDefined()` without verifying specific content. These only prove the endpoint doesn't crash, which is already covered by any substantive test in the same describe block.
  - **Trivial library passthrough**: assertions like `typeof x === "function"` or `Array.isArray(x)` that verify the shape of a value without checking its behavior or content.

## Git Workflow

When creating commits:

1. Read all dirty changes
2. Group related changes into logical commits
3. Write verbose messages focused on *why*, not *what*
