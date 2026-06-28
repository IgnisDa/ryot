# Ryot Change Guidelines

## Documentation

- Keep `AGENTS.md` to stable, non-obvious rules that affect changes. Put architecture, protocols, runbooks, and rationale in `README.md`; child files must not restate parent guidance.

## Ownership

- `kernel/backend` is domain-agnostic. `kernel/client` is the React DOM client kernel and Capacitor app.
- `apps/server` assembles the backend kernel, migrations, and shipped plugin archives.
- `plugins/*` own first-party plugins (`media`, `fitness`, `fixture`), each split into host-side `host/`, archived `backend/`, and archived `client/`.
- `migrations/*` own one-time migrations that depend on the kernel.
- `packages/contract` owns the client-safe HTTP boundary, generic shared wire schemas, and plugin manifests; `packages/client-plugin-contract` owns the client plugin bridge protocol, artifact model, source file policy, and shared client-plugin capability payloads. `packages/plugin-kit` documents the plugin authoring surface.
- `packages/client-sdk` and `packages/client-ui-sdk` are the environment-neutral plugin-facing client surfaces; `packages/sandbox-sdk` is their backend counterpart.
- `packages/sandbox-compiler` and `packages/client-plugin-compiler` are independent engines sharing generic infrastructure from `packages/typescript-compiler`.
- `packages/cli` builds canonical plugin archives for first-party and third-party plugins; `packages/plugin-archive` owns the shared deterministic archive reader and writer.
- `packages/ryotql` builds query documents and `packages/ryotql-recipes` owns the named recipes.
- `packages/kernel-renderers` owns the kernel-shipped saved-view renderers as real client plugin sources.

## Engineering

- Make the smallest correct change. Do not add unrequested functionality, abstractions, or generalization.
- Derive types from schemas and existing types instead of writing mirrors. Use Effect Schema.
- Build application-owned query documents with `@ryot-app/ryotql` and use named recipes when available.
- Colocate app-owned RyotQL result schemas, decoders, and decoded types with their recipes. Consumers must not parse generic `RowItem` values directly; reusable wire codecs belong in `@ryot-app/contract`, while presentation-only transformations remain consumer-owned.

## Testing

- Do not add tautological tests.
- Test app-owned behavior and branching, not library behavior.
- Keep assertions inline; extract duplicated setup, not test intent.
- Use assertion functions from the package's test surface for test-only narrowing.
- Do not test schema libraries, TypeScript assignments, or passthrough type checks.
- Do not use module mocks, spies, mock functions, or fake timers. Inject dependencies instead: deterministic Effect `Layer` implementations, `TestClock` for time, plain recording functions, and the harnesses on each package's own test surface.
