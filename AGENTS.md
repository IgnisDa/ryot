# Ryot Change Guidelines

## Documentation And Ownership

- Keep `AGENTS.md` to stable, non-obvious editing rules. Put architecture, protocols, runbooks, and rationale in READMEs. Describe only the current state; children must not repeat parent rules.
- Follow the [code ownership map](README.md#code-ownership). Kernel code, sandbox code, and shared wire schemas stay product-agnostic, including copy and fixtures. Plugins supply domain vocabulary and behavior; never branch on their IDs or slugs in the kernel.

## Engineering

- Make the smallest correct change; add no unrequested functionality or abstractions.
- Ryot is greenfield. Add no compatibility paths or retained obsolete APIs, including SDK exports. Explicit legacy exceptions in child `AGENTS.md` files are exempt.
- Keep artifact, backup, manifest, protocol, compiler, and API version constants unchanged. Outside legacy exceptions, do not name code after versions.
- Import from defining modules. Re-exports and aliases are allowed only at aggregation points declared in child instructions.
- Default to no comments. Explain only non-obvious constraints the code cannot express; remove redundant or stale comments when editing.
- Ask before adding type-checker bypass casts or lint suppressions. The documented `effecttsgo/async-function` exemption is the only standing exception.
- Application-owned asynchronous work uses Effect. Native Promises belong at platform/framework boundaries; use readable async/await there with the narrow documented exemption, not Promise chains.
- Resolve dependencies in service constructors and feature-owned Layers; boot Layers compose features. Use `Effect.fn`/`Effect.fnUntraced` for reusable operations and `Effect.gen` for local flow.
- Derive types from Effect Schema and existing types. Build queries with `@ryot-app/ryotql` and named recipes; colocate result schemas, decoders, and types with recipes. Consumers never parse generic `RowItem` values; reusable wire codecs belong in `@ryot-app/contract`.
- Key rolling queries by stable selections; compute moving timestamps from the supplied clock during execution.
- User-facing pagination uses shared SDK primitives; load-more indicators follow `isFetchingNextPage`, never generic `isFetching`.
- Plugin layouts use bridged `compact` and safe-area values, not iframe media queries or `env()`.
- Reordering uses shared platform haptics; plugins never invoke native APIs.

## Testing

- Test application behavior and branches, not library behavior, schema libraries, or TypeScript assignments. Compile-time tests may constrain Ryot-owned generics.
- Keep assertions inline and extract duplicated setup, not intent. Use package assertion helpers for test-only narrowing.
- DOM tests use `.test.tsx`; node tests use `.test.ts`. The shared client Vitest config selects the environment; do not add environment docblocks.
- Do not use module mocks, spies, mock functions, or fake timers. Inject Effect Layers, TestClock, plain recording functions, and package-owned harnesses instead.

## Workflow

- Stay within the agreed scope. Ask before widening it; do not start another review round after findings are addressed.
- During implementation, make affected package/app checks pass before running their tests. Both must pass before review; include results in the handoff.
- Reviews are read-only. Reviewers report findings without editing files or rerunning checks/tests.
- For code changes, complete implementation and review fixes, then execute `.agents/skills/codebase-cleanup` in the main session.
- Run repository-wide validation only at the end. For code changes, `bun run check` must pass before `bun turbo --filter='!@ryot-app/e2e' test`; both must pass before completion. Run only affected e2e files, never the whole suite.
