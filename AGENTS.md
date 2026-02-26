# Ryot Agent Guidelines

This file contains coding conventions, workflows, and best practices for AI agents working on the Ryot project. Follow these guidelines to maintain code quality and consistency.

## Project Architecture & Tools

### Code Navigation

Use tools from the Serena MCP (if available) for faster code navigation and retrieval. It supports TypeScript.

### Monorepo Management

The project uses `turbo` for monorepo management. All frontend-related commands (type checking, running tests, etc.) must use `turbo` commands.

### Project Overview

Read `apps/docs/src/contributing.md` for an overview of the project architecture and common commands.

### Command Line Usage

When running bash commands (`git`, `sed`, etc.), always quote paths using single quotes since they often contain special characters.

Example: `git add 'path/with-special-chars/file.ts'`

### GitHub Data Access

Use the `gh` CLI for GitHub operations. Only make raw API requests when the `gh` CLI does not support the required functionality.

## Development Workflow

### Code Quality Checks

Run the relevant commands before committing to ensure changes do not break anything:

```bash
bun run turbo typecheck
bun run turbo build --filter=@ryot/docs
```

### Testing Workflow

When running tests:

1. Implement the feature first
2. Always ask the user's approval to run tests
3. Run `bun run turbo test --filter=@ryot/tests`

### GraphQL Code Generation

After adding a GraphQL query or mutation to the backend:

1. Start the backend server in debug mode in the background
2. Run `bun run turbo backend-graphql --filter=@ryot/generated` to generate frontend types
3. Stop the backend server after generation completes

This ensures the frontend can use the new query or mutation with proper type safety.

## Coding Standards

### Code Comments

Do not add code comments unless strictly necessary. Prefer self-documenting code with clear variable names, function names, and structure.

### File Size

Keep code files below 500 lines. If a file exceeds this limit, split it into smaller files using functions, components, or modules to improve readability and maintainability.

### React Component Props

React components must use a single `props` parameter instead of destructured props in function arguments.

**Correct:**

```typescript
function MyComponent(props: MyComponentProps) {
  return <div>{props.title}</div>;
}
```

**Incorrect:**

```typescript
function MyComponent({ title }: MyComponentProps) {
  return <div>{title}</div>;
}
```

### TypeScript Return Types

Do not add explicit return types to functions unless required. TypeScript's type inference is sufficient in most cases.

Explicit return types may be necessary when:

- The inferred return type is too complex or unclear
- Enforcing a specific return type contract is desired

### Field Ordering by Line Length

When initializing object literals (TypeScript), order fields by ascending line length - shorter lines first, longer lines last. This applies to:

- TypeScript/JavaScript object literals
- JSX component props

**Example:**

```typescript
const notification = {
    color: "red",
    title: "Invalid action",
    message: "Changing preferences is disabled for demo users",
};
```

**Exceptions (correctness takes precedence):**

- Semantic grouping may override length ordering when it improves readability
- Shorthand fields (just the field name) typically come before assignment expressions of similar length

### Variable Declaration Ordering by Line Length

When declaring multiple variables in sequence (particularly React hooks), order them by ascending line length:

```typescript
const navigate = useNavigate();
const isMobile = useIsMobile();
const { startOnboardingTour } = useOnboardingTour();
const isOnboardingTourCompleted = useIsOnboardingTourCompleted();
const markUserOnboardingStatus = useMarkUserOnboardingTourStatus();
```

This pattern applies to:

- React hook calls at the start of components
- Sequential `const`/`let` declarations

**Return Object Example:**

```typescript
return {
    userDetails,
    coreDetails,
    isDemoInstance,
    shouldHaveUmami,
    currentColorScheme,
    desktopSidebarCollapsed,
    userPreferences: userDetails.preferences,
};
```

**Note:** This pattern does NOT apply to import statements (which follow alphabetical ordering enforced by tooling) or function parameters (which follow semantic ordering).

## Git Workflow

### Creating Commits

When asked to create a git commit:

1. Read all dirty changes in the repository
2. Create logical commits, grouping related changes together
3. Create multiple commits as needed for different logical units of work
4. Write verbose commit messages that explain the reasoning behind the changes, not just what was changed

Focus on the "why" rather than the "what" in commit messages.
