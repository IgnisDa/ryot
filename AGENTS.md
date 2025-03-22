# Ryot Agent Guidelines

## Project Architecture & Tools

- **Monorepo**: Uses `turbo`. All frontend commands must use `turbo`.
- **Dependencies**: `cd <app> && bun add -E` (exact versions, no ranges).
- **Bash paths**: Always quote with single quotes (e.g., `git add 'path/file.ts'`).
- **GitHub**: Use `gh` CLI; raw API only when `gh` doesn't support it.

## Coding Standards

- **Pattern discovery**: Before writing new code, launch an `explore` subagent to find existing patterns and replicate them.
- **Comments**: Avoid unless strictly necessary. Prefer self-documenting code.
- **File size**: Keep files below 500 lines. Split if exceeded.
- **React props**: Use a single `props` parameter, not destructured arguments.

```typescript
function MyComponent(props: MyComponentProps) {
  return <div>{props.title}</div>;
}
```

- **Return types**: Omit explicit return types unless inference is insufficient.
- **Field/variable ordering**: Order by ascending line length (shorter first). Exceptions for semantic grouping. Does not apply to imports or function parameters.

```typescript
const notification = {
    color: "red",
    title: "Invalid action",
    message: "Changing preferences is disabled for demo users",
};
```

## Git Workflow

When creating commits:

1. Read all dirty changes
2. Group related changes into logical commits
3. Write verbose messages focused on *why*, not *what*
