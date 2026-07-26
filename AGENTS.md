# Ryot Agent Guidelines

## Documentation

- Keep `AGENTS.md` to stable, non-obvious rules that affect changes. Put architecture, protocols, runbooks, and rationale in `README.md`; child files must not restate parent guidance.

## Workspace Map

Workspaces are `apps/*`, `kernel/*`, `migrations/*`, `packages/*`, `plugins/*`, and `e2e`.

- `kernel/backend` is the domain-agnostic backend; `kernel/client` is the React DOM client kernel, which also ships as the Capacitor native app.
- `apps/server` assembles the backend kernel, migrations, and shipped plugin archives. `apps/website`, `apps/docs`, and `apps/browser-extension` are the marketing site, the user documentation, and the browser extension.
- `plugins/*` own first-party plugins (`media`, `fitness`, `fixture`), each split into host-side `host/`, archived `backend/`, and archived `client/`.
- `migrations/*` own one-time migrations that depend on the kernel.
- `packages/contract` owns the client-safe HTTP boundary, generic shared wire schemas, and plugin manifests; `packages/client-plugin-contract` owns the client plugin bridge protocol, artifact model, source file policy, and shared client-plugin capability payloads. `packages/plugin-kit` documents the plugin authoring surface.
- `packages/client-sdk` and `packages/client-ui-sdk` are the environment-neutral plugin-facing client surfaces; `packages/sandbox-sdk` is their backend counterpart.
- `packages/sandbox-compiler` and `packages/client-plugin-compiler` are independent engines sharing generic infrastructure from `packages/typescript-compiler`.
- `packages/cli` builds canonical plugin archives for first-party and third-party plugins; `packages/plugin-archive` owns the shared deterministic archive reader and writer.
- `packages/ryotql` builds query documents and `packages/ryotql-recipes` owns the named recipes.
- `packages/config`, `packages/testing`, `packages/transactional`, and `packages/ts-utils` are shared internals.
- `e2e` owns the end-to-end suite. `ci/` holds deployment assets (Helm chart, Fly, Caddy) and is not a workspace.

## Tools

- Use `turbo` for monorepo frontend commands.
- Use `gh` for GitHub; use the raw API only when `gh` lacks support.
- Add dependencies from the target app with `bun add`.
- Quote shell paths with single quotes, for example `git add 'path/file.ts'`.
- Check backend code with `bun turbo --filter=@ryot-app/kernel-backend check` and test it with `bun turbo --filter=@ryot-app/kernel-backend test`.

## Engineering

- Do not add un-requested functionality, abstractions, or generalization.
- Derive types from schemas and existing types instead of writing mirrors. Use Effect Schema.
- Build application-owned query documents with `@ryot-app/ryotql` and use named recipes when available.
- Colocate app-owned RyotQL result schemas, decoders, and decoded types with their recipes. Consumers must not parse generic `RowItem` values directly; reusable wire codecs belong in `@ryot-app/contract`, while presentation-only transformations remain consumer-owned.
- Prefer `Match` from `effect` over `switch`.
- If you are writing code, use an `explore` subagent only to find existing patterns.
- Avoid comments unless necessary.
- Omit return types when inference is sufficient.
- Order fields and variables by ascending line length unless semantic grouping is clearer. This does not apply to imports.

## Testing

- Do not add tautological tests.
- Test app-owned behavior and branching, not library behavior.
- Keep assertions inline; extract duplicated setup, not test intent.
- Use assertion functions from the package's test surface for test-only narrowing.
- Do not test schema libraries, TypeScript assignments, or passthrough type checks.
