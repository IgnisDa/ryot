# Ryot Agent Guidelines

## Documentation

- Keep `AGENTS.md` to stable, non-obvious rules that affect changes. Put architecture, protocols, runbooks, and rationale in `README.md`; child files must not restate parent guidance.

## Tools

- Use `turbo` for monorepo frontend commands.
- Use `gh` for GitHub; use the raw API only when `gh` lacks support.
- Add dependencies from the target app with `bun add`.
- Quote shell paths with single quotes, for example `git add 'path/file.ts'`.
- Check backend code with `bun turbo --filter=@ryot/app-backend check` and test it with `bun turbo --filter=@ryot/app-backend test`.
- Use `@explore` agents only for bounded read-only exploration; they must not make decisions. Give them small tasks so as to not overwhelm their context window. Use multiple agents for larger explorations.

## Engineering

- Do not add un-requested functionality, abstractions, or generalization.
- Derive types from schemas and existing types instead of writing mirrors. Use Effect Schema.
- Build application-owned query documents with `@ryot/query-engine` and use named recipes when available.
- Colocate app-owned RyotQL result schemas, decoders, and decoded types with their recipes. Consumers must not parse generic `RowItem` values directly; reusable wire codecs belong in `@ryot/contract`, while presentation-only transformations remain consumer-owned.
- Prefer `Match` from `effect` over `switch`.
- If you are writing code, use an `explore` subagent only to find existing patterns.
- Avoid comments unless necessary.
- Omit return types when inference is sufficient.
- Order fields and variables by ascending line length unless semantic grouping is clearer. This does not apply to imports.

## Testing

- Test app-owned behavior and branching, not library behavior.
- Keep assertions inline; extract duplicated setup, not test intent.
- Use assertion functions from the package's test surface for test-only narrowing.
- Do not test schema libraries, TypeScript assignments, or passthrough type checks.
