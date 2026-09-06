# Ryot Change Guidelines

## Documentation

- Keep `AGENTS.md` to stable, non-obvious rules that affect changes. Put architecture, protocols, runbooks, and rationale in `README.md`; child files must not restate parent guidance.
- Keep documentation lean and describe only the current state. Do not record history, superseded designs, or task progress.

## Ownership

- `kernel/backend` is domain-agnostic. `kernel/client` is the React DOM client kernel and Capacitor app.
- `apps/server` assembles the backend kernel, owns one-time migrations, and ships plugin archives.
- `plugins/*` own first-party plugins (`media`, `fitness`, `fixture`), each split into host-side `host/`, archived `backend/`, and archived `client/`.
- `packages/contract` owns the client-safe HTTP boundary, generic shared wire schemas, and plugin manifests; `packages/client-plugin-contract` owns the client plugin bridge protocol, artifact model, source file policy, and shared client-plugin capability payloads. `packages/plugin-kit` documents the plugin authoring surface.
- `packages/client-sdk` and `packages/client-ui-sdk` are the environment-neutral plugin-facing client surfaces; `packages/sandbox-sdk` is their backend counterpart.
- `packages/sandbox-compiler` and `packages/client-plugin-compiler` are independent engines sharing generic infrastructure from `packages/typescript-compiler`.
- `packages/cli` builds canonical plugin archives for first-party and third-party plugins; `packages/plugin-archive` owns the shared deterministic archive reader and writer.
- `packages/ryotql` builds query documents; `packages/ryotql-recipes` owns application recipes, and plugins own their domain recipes under `shared/`.
- `packages/kernel-renderers` owns the kernel-shipped saved-view renderers as real client plugin sources.

## Engineering

- Make the smallest correct change. Do not add unrequested functionality, abstractions, or generalization.
- Ryot is greenfield, with no deployments or user data to preserve. Do not add compatibility paths, bridges, fallbacks, adapters, or old code paths, and do not keep exports for outside consumers, including the plugin SDKs. Directories whose `AGENTS.md` declares them a legacy exception are exempt.
- Keep artifact, backup, manifest, protocol, compiler, and API version constants at their current values. Outside legacy exceptions, do not name code after versions such as `V2` or `archive-v2`.
- Import symbols from their defining module. Do not re-export or alias another module's symbols; package entry points and barrels documented in a child `AGENTS.md` are the only aggregation points.
- Comment only a non-obvious reason or invariant. Do not restate code or refer to history, tasks, or plans.
- Lint suppressions and casts that bypass the type checker are a last resort; ask the user before adding one. The documented `effecttsgo/async-function` exemption is the only standing exception.
- Derive types from schemas and existing types instead of writing mirrors. Use Effect Schema.
- Build application-owned query documents with `@ryot-app/ryotql` and use named recipes when available.
- Colocate app-owned RyotQL result schemas, decoders, and decoded types with their recipes. Consumers must not parse generic `RowItem` values directly; reusable wire codecs belong in `@ryot-app/contract`, while presentation-only transformations remain consumer-owned.
- User preferences use the canonical contract schema on the user row. Better Auth sessions do not own or expose preferences; preference commands patch the row atomically.
- Committed mutation receipts own command replay independently of automation history. Keep full change evidence only for matching hooks or pending batch-hook candidates.
- Application-owned asynchronous work uses Effect; native Promises belong at platform and framework boundaries.
- At APIs that natively require Promise-returning callbacks, prefer readable async/await with a narrow documented `effecttsgo/async-function` exemption; do not rewrite Promise boundaries as `.then` chains. Application-owned asynchronous orchestration remains Effect.
- Resolve implementation dependencies in service constructors and Layers; service methods must not require their repositories or database session from callers.
- Use `Effect.fn` or `Effect.fnUntraced` for reusable effectful operations, `Effect.gen` for local control flow, and `pipe` for short transformations.
- Feature modules own their canonical Layers; boot modules compose feature Layers.

## Testing

- Do not add tautological tests.
- Test app-owned behavior and branching, not library behavior.
- Keep assertions inline; extract duplicated setup, not test intent.
- Use assertion functions from the package's test surface for test-only narrowing.
- Do not test schema libraries, TypeScript assignments, or passthrough type checks. Compile-time tests may constrain Ryot-owned generic contracts.
- Name a test `.test.tsx` when it needs a DOM and `.test.ts` when it must keep node semantics; `@ryot-app/testing/vitest.client` maps those extensions onto the `node` and `dom` vitest projects, so never reach for a `@vitest-environment` docblock.
- Do not use module mocks, spies, mock functions, or fake timers. Inject dependencies instead: deterministic Effect `Layer` implementations, `TestClock` for time, plain recording functions, and the harnesses on each package's own test surface.

## Workflow

- Stay within the agreed scope. Ask before widening it, and do not start another review round once findings are addressed.
- Work is done when `bun run check` and `bun turbo --filter='!@ryot-app/e2e' test` are clean. Run only the affected e2e files, never the whole e2e suite.
