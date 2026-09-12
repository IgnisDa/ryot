# Ryot Effect Architecture Refactor

## Objective

Refactor Ryot's active TypeScript codebase so Effect is used consistently and idiomatically, with particular emphasis on:

- explicit and understandable service boundaries;
- a first-class database session / unit-of-work abstraction;
- transaction propagation that is invisible to repositories and callers;
- service methods that do not leak implementation requirements;
- feature-owned Layer composition instead of giant composition roots;
- Effect-native asynchronous client/plugin APIs;
- typed Effect failures rather than `unknown` or global `Error`;
- substantially less nested `Effect.gen`, `pipe`, `Effect.provide`, Promise plumbing, and manual cancellation code;
- removal of custom architecture tooling where upstream Effect/Oxlint rules or structural APIs can enforce the invariant;
- major reduction of `kernel/backend/scripts` and `apps/server/scripts`;
- repository-wide retirement of the temporary Effect lint warning overrides added by `a92dd652...`;
- updated architecture documentation and lean `AGENTS.md` guidance.

This is a greenfield refactor. Breaking internal and plugin-authoring API changes are expected. Do not add deprecated aliases, compatibility adapters, dual code paths, old protocol decoders, migration bridges, or temporary fallback implementations.

## Baseline

Start from `ultra-rewrite` at or after:

```text
a92dd652e4e4aa036b7395c2eef5007d85d14202
[effect-improvements] build: restore a green Effect lint baseline
```

That commit is the baseline. Do not redo its stabilization work.

The root `check` must remain green throughout the refactor.

The temporary warning scopes in `.oxlintrc.json` and `docs/effect-lint-baseline.md` are the migration queue. Remove each warning downgrade as its owning code is migrated. Never widen a warning scope to accommodate new code.

Do not restore the TypeScript language-service plugin. Oxlint remains the authoritative Effect diagnostic surface.

## Explicit non-goals

Do not:

- remove or clean up legacy `crates/**` trees;
- perform unrelated legacy-tree deletion;
- modify `e2e/src/scripts/seed.ts`;
- modify `e2e/src/scripts/seed-client-plugin.ts`;
- change E2E worker counts, PostgreSQL pool sizing, sandbox concurrency, timeouts, or other load-sensitive settings;
- merge the client-plugin compiler and sandbox compiler;
- widen the neutral `@ryot-app/plugin-kit/effect` surface to export `Effect`;
- change sandbox capabilities, security policy, resource limits, replay semantics, or HTTP admission semantics;
- redesign product behavior;
- change bridge wire behavior merely to facilitate this refactor.

If implementation reveals that one of those must change to proceed, stop and ask the user.

---

# 1. Establish the architectural invariants

These invariants apply to all subsequent phases.

### Service boundary invariant

A normal application service method must not expose implementation services in its `R` channel.

Target:

```ts
service.operation(input)
// Effect<Result, DomainError>
```

Not:

```ts
service.operation(input)
// Effect<Result, DomainError, Database | SomeRepository | PgClient>
```

Exceptions are only genuinely dynamic request/context services that are intentionally part of the API. Use the Effect leak annotations only for those deliberate cases, not to silence implementation leakage.

### Dependency ownership invariant

A service constructor captures its static implementation dependencies once.

```ts
class FooService extends Context.Service<FooService>()("FooService", {
  make: Effect.gen(function* () {
    const repository = yield* FooRepository;

    const operation = Effect.fn("FooService.operation")(function* (...) {
      return yield* repository.operation(...);
    });

    return { operation };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(FooRepository.layer),
  );
}
```

Use a feature `layer.ts` when putting the canonical layer beside the service would create a real module cycle.

### Layer invariant

`boot/layers.ts` files are composition roots, not transitive dependency registries.

They should combine a small number of feature/infrastructure Layers and should not know how every repository and service is constructed.

### Transaction invariant

A domain service that owns a transaction must continue to reject invocation from an already active transaction where it does so today.

Shared atomic writes use one owning transaction and transaction-scoped repository/internal operations. Do not silently introduce nested transactions or savepoint semantics.

Never hold a database transaction over:

- network calls;
- sandbox execution;
- workflow boundaries;
- sleeps;
- durable work;
- unbounded fan-out;
- post-commit dispatch.

### Effect authoring invariant

Use:

- `Effect.gen` for local imperative control flow;
- `Effect.fn("Name")` for reusable operations where tracing is valuable;
- `Effect.fnUntraced` for small reusable internal/hot-path operations;
- `pipe` for short transformation/decorator sequences.

Do not introduce nested `Effect.gen(...).pipe(...)` merely to manufacture a combinator boundary. Extract a named reusable effect or inline the generator.

For intentionally sequential imperative work, prefer a `for...of` loop inside an existing generator over `Effect.forEach(..., () => Effect.gen(...))`. Keep `Effect.forEach` where its concurrency/collection semantics matter.

### Asynchronous invariant

Application-owned asynchronous behavior is Effect.

Native Promises are allowed at actual external/framework boundaries. Convert them to Effect immediately with `Effect.tryPromise`, `Effect.promise`, `Effect.async`, or an appropriate Effect platform API.

Do not convert Effect → Promise → Effect inside Ryot.

---

# 2. Introduce `DatabaseSession`

Do this before the broader backend service refactor.

## 2.1 Replace the current `Database` contextual executor

Current behavior relies on repository methods yielding `Database` at call time and transaction owners replacing it using:

```ts
Effect.provideService(Database, tx)
```

Remove that mechanism completely.

Create `DatabaseSession` under the existing database infrastructure, for example:

```text
kernel/backend/src/lib/infrastructure/db/session.ts
```

Retain error mapping/shared helpers in the database infrastructure rather than duplicating them.

The session owns:

- the root Drizzle `EffectPgDatabase`;
- a `FiberRef` containing the current transactional executor, or the equivalent explicit transaction state;
- lookup of the currently active executor;
- transaction ownership;
- transaction-state assertions.

Its conceptual API is:

```ts
type DatabaseSessionShape = {
  readonly current: Effect.Effect<EffectPgDatabase>;

  readonly isTransactionActive: Effect.Effect<boolean>;

  readonly requireRoot: Effect.Effect<
    void,
    DatabaseSessionStateError
  >;

  readonly requireTransaction: Effect.Effect<
    void,
    DatabaseSessionStateError
  >;

  readonly transaction: <A, E, R>(
    work: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | DbError | DatabaseSessionStateError, R>;
};
```

Use one tagged infrastructure error for invalid session state with discriminated reasons such as:

```text
transaction-already-active
transaction-required
```

Do not make this error part of HTTP/public domain contracts. Owning services map it to their existing domain errors where required.

## 2.2 Root database construction

The raw Drizzle database construction must become private infrastructure.

The root database executor must not remain an application-facing `Context.Service` that repositories can yield directly.

`DatabaseSession.layer` should construct the root Drizzle database from the canonical PgClient layer.

Tests may construct the session from test PgClient infrastructure through `DatabaseSession.make`; do not create a second transaction implementation for tests.

## 2.3 Transaction behavior

`DatabaseSession.transaction(work)` must:

1. verify no transaction is already active;
2. enter Drizzle's transaction callback;
3. install the transaction executor in the FiberRef for the exact lifetime of `work`;
4. restore the previous/root executor on success, typed failure, defect, or interruption;
5. map native Drizzle/Effect SQL failures to `DbError`;
6. preserve non-database errors from `work`;
7. not catch or flatten domain failures.

Do not implement nested savepoints.

## 2.4 Repository migration

Every repository should capture `DatabaseSession` in its constructor:

```ts
make: Effect.gen(function* () {
  const database = yield* DatabaseSession;

  const find = Effect.fn(...)(function* (...) {
    const db = yield* database.current;
    ...
  });

  return { find };
});
```

Repository operations themselves must no longer require `DatabaseSession`, `Database`, or `PgClient` in their `R` channel.

Migrate every repository, not only entities/collections.

Remove:

- `@effect-leakable-service` from the old database executor;
- all `yield* Database` outside database infrastructure;
- all application `Effect.provideService(Database, ...)`;
- all direct transaction-state inspection through `PgClient.transactionService` outside database infrastructure.

`setLocalStatementTimeout`, advisory-lock helpers, and similar database utilities must use `DatabaseSession.current`.

## 2.5 Entity transaction ownership

Replace the existing `EntitiesService` `assertOwner`/`assertActiveTransaction` PgClient logic with `DatabaseSession.requireRoot` and `DatabaseSession.requireTransaction`.

Preserve existing domain behavior:

- public/owning entity writes reject an enclosing transaction with the existing `EntityBadRequest` reason;
- internal persistence operations that require a transaction continue to fail as `LifecyclePersistenceError` when called without one.

`retryOnDeadlock` must wrap the complete transaction attempt, not an already-open transaction body.

## 2.6 Database tests

Add focused tests for:

- root operations use the root executor;
- repository calls inside `DatabaseSession.transaction` see the transaction automatically;
- multiple repositories participate in the same transaction automatically;
- rollback removes all writes;
- transaction state is restored after success;
- transaction state is restored after typed failure;
- transaction state is restored after interruption;
- nested transaction ownership is rejected;
- `requireRoot` and `requireTransaction` behave correctly;
- deadlock retry still retries the whole transaction;
- no transaction context leaks into later unrelated work.

Use real Effect Layers/test PostgreSQL infrastructure. Do not add mocks.

---

# 3. Repair backend service boundaries

Start with the dependency hub, then work outward.

Recommended order:

```text
entities
relationships
events
collections
lifecycle infrastructure
plugins
saved views / client pages
imports / integrations
automations
sandbox
backups
auth / user bootstrap / settings / uploads
remaining backend modules
```

For every service/repository:

1. capture static dependencies during construction;
2. remove implementation requirements from returned method Effects;
3. remove caller-side `Effect.provideService` plumbing;
4. make the canonical live Layer own immediate dependencies;
5. use typed errors;
6. clean local nested generator/style problems while the file is already being changed.

The end goal is that `effecttsgo/leaking-requirements` reports no ordinary application service leakage.

## 3.1 Remove `CollectionsService.provideMutation`

The current `provideMutation` helper is a primary target.

After repository/service dependency encapsulation, `CollectionsService` must call:

```ts
yield* entities.create(...)
yield* relationships.applyPolicies(...)
```

directly.

It must not capture and re-provide:

- `Database`;
- `PgClient.PgClient`;
- `EntitiesRepository`;
- `LifecyclePlanner`;
- `LifecycleExecution`.

The same rule applies to equivalent helpers elsewhere.

## 3.2 Large service files

After dependency cleanup, split oversized constructors where doing so clarifies real concepts.

Do not create Context services merely to reduce file length.

Prefer internal modules containing `Effect.fn`/`Effect.fnUntraced` operations that accept the small set of already-captured implementation values they genuinely need.

Examples of good internal seams:

```text
mutation planning
mutation persistence
policy application
replay handling
catalog materialization
archive restore persistence
plugin package validation
```

Avoid generic `utils.ts`, `helpers.ts`, or arbitrary “manager” services.

## 3.3 Effect style cleanup

While touching each module:

- flatten `yield* Effect.gen(...)` when it is just nested control flow;
- extract meaningful protected/finalized regions to named Effect functions;
- use `Effect.ensuring`/`acquireRelease`/scoped resources rather than nested generators built solely for cleanup;
- replace reusable `() => Effect.gen(...)` functions with `Effect.fn`/`Effect.fnUntraced`;
- replace sequential nested `Effect.forEach` generators with loops where appropriate;
- retain concise transformation pipes.

---

# 4. Localize backend Layer ownership

Once service requirements are encapsulated, restructure Layers.

## 4.1 Canonical service layers

Primary service Layers should live with the service or feature.

Example:

```ts
static readonly layer = Layer.effect(this, this.make).pipe(
  Layer.provide(Repository.layer),
  Layer.provide(OtherCanonicalDependency.layer),
);
```

When several services form one feature or inline wiring causes an import cycle, add:

```text
modules/<feature>/layer.ts
```

Do not move everything into another global `layers.ts`.

## 4.2 Distinct runtime variants

Where Ryot genuinely has different implementations, give them different Layer identities deliberately.

For plugin installation, for example, use explicitly constructed named variants such as:

```text
PluginInstallation.layerRuntime
PluginInstallation.layerMigration
```

or feature-owned named Layers.

Do not build the same `Service.layer` object with different dependency implementations and rely on `Layer.fresh`.

Remove the current load-bearing `Layer.fresh` workaround once the graph has distinct layer identities.

Do not add a replacement custom duplicate-Layer checker.

## 4.3 Backend composition root

Shrink `kernel/backend/src/boot/layers.ts`.

Its target responsibility is:

```text
infrastructure
feature layers
server/application composition
```

not:

```text
every repository
every service
every transitive dependency
every implementation variant
```

There is no required line-count target; the criterion is ownership.

---

# 5. Delete backend architecture-check machinery

Do this only after the new architecture enforces the same invariants structurally.

The final repository should have no `kernel/backend/scripts` directory.

## 5.1 Duplicate Layer check

Delete:

```text
kernel/backend/scripts/layer-wiring.ts
kernel/backend/scripts/layer-wiring.test.ts
```

The new Layer topology and Effect rules replace it.

## 5.2 Runtime cycle analysis

Delete:

```text
kernel/backend/scripts/runtime-module-analysis.ts
kernel/backend/scripts/runtime-module-analysis.test.ts
```

`import/no-cycle` is already a repository error and is stricter than the backend-only runtime graph check.

Do not retain two cycle systems.

## 5.3 Backup restore boundary

Do not retain a source-text checker for restore method calls.

Move historical persistence operations out of ordinary domain repository public surfaces and into the backup restore persistence implementation.

Target:

```text
kernel/backend/src/modules/backups/restore/
  writer.ts
  persistence.ts    // or an equivalently focused name
```

The backup restore persistence layer may write historical values directly because it is explicitly the historical restoration boundary.

Ordinary repositories must no longer expose general-purpose methods such as:

```text
restoreEntity
restoreEvents
restoreRelationship
restorePortableProfile
restoreRenderer
restoreForUser
restoreTranslation
restoreCustomView
restoreNotificationSubscription
activateRestored
installations.restore
```

Remove those APIs rather than policing their callers.

Update the backend documentation accordingly.

## 5.4 Workflow construction boundary

Keep:

```text
makeActivity
implementWorkflow
```

as the only application workflow construction API.

Prevent application modules from importing/using the raw constructors through normal lint/import restrictions rather than source scanning.

Remove the custom checks for:

```text
Activity.make(...)
.toLayer(...)
```

Do not weaken the current workflow/activity ownership semantics.

## 5.5 Demo access policy

Replace the TypeScript-AST contract scanner with a contract construction API that makes mutation policy explicit.

Create a small contract-owned endpoint construction surface so authenticated mutation endpoints require a `DemoAccessPolicy` argument when constructed.

Migrate all authenticated POST/PUT/PATCH/DELETE endpoints to it.

Do not retain both raw authenticated mutation construction and the new helper as accepted patterns.

Public/admin endpoints can retain their appropriate raw/explicit construction surface; document the distinction in `packages/contract/AGENTS.md`.

## 5.6 Remove architecture command

Once all checks above have structural replacements, delete:

```text
kernel/backend/scripts/check-architecture.ts
kernel/backend/scripts/check-architecture.test.ts
```

Remove:

```text
architecture:check
```

from `kernel/backend/package.json`.

`check` must become ordinary typecheck/format/lint plus the sandbox runner validation.

---

# 6. Move sandbox build tooling out of backend scripts

The sandbox build functionality is real and must remain. Its current ownership is wrong.

Move generic runtime-build functionality from `kernel/backend/scripts` into `packages/sandbox-compiler`, under a clear runtime-build namespace such as:

```text
packages/sandbox-compiler/src/runtime-build/
  inputs.ts
  payload.ts
  registry.ts
  source-tree.ts
```

Move their tests alongside those modules.

This includes the responsibilities currently in:

```text
sandbox-runtime-inputs.ts
sandbox-runtime-payload.ts
sandbox-runtime-registry.ts
walk-source-tree.ts
```

The generic compiler package must not import kernel domain modules.

Keep the client compiler and sandbox compiler separate.

## 6.1 Kernel-specific build entrypoint

The small amount of kernel-specific orchestration that:

- compiles the Deno runner;
- builds the trusted runtime payload;
- embeds kernel sandbox scripts;
- writes generated kernel runtime artifacts;

should live under an explicitly build-owned path, e.g.:

```text
kernel/backend/build/sandbox-runtime.ts
```

not under application source and not under `scripts/`.

`kernel/backend/package.json` may invoke this build entrypoint.

Do not create a generic catch-all tooling package.

## 6.2 Preserve deterministic artifacts

Moving the build code must not change:

- runtime payload format;
- Deno version;
- dependency registry;
- import-map semantics;
- alias identity;
- source hashes;
- file hashes;
- generated kernel-script bytes;
- sandbox runner limits;
- runtime security policy.

Update Turbo inputs/outputs after paths move.

---

# 7. Make the client SDK core Effect-native

This is the main client/plugin refactor.

Do not change the bridge's user-visible capabilities or security model.

## 7.1 Environment-specific Effect surface

Change:

```text
@ryot-app/client-sdk/effect
```

to export `Effect` in addition to the currently approved client-safe Effect utilities.

Client-only plugin code may use that surface.

Do **not** add `Effect` to:

```text
@ryot-app/plugin-kit/effect
```

That package remains the neutral shared-code shim because it is also usable by sandbox/shared plugin code.

Backend sandbox code continues to use:

```text
@ryot-app/sandbox-sdk/effect
```

## 7.2 `RyotClientError`

Convert the client failure type to a proper typed Effect failure, preferably a `Data.TaggedError`/equivalent Effect-native error while preserving the existing public `reason` vocabulary.

Do not alter the documented reason set unless existing behavior proves a reason unreachable.

Do not expose global `Error` as the Effect error channel.

## 7.3 Adapter operations

Change asynchronous `RyotClientAdapter` capabilities from Promise APIs to Effect APIs.

This includes:

- RyotQL query;
- operation invocation;
- collection mutation;
- temporary upload;
- managed asset resolution;
- plugin storage operations where asynchronous;
- other asynchronous capability calls discovered in this surface.

Remove `AbortSignal` parameters where cancellation exists solely to model Effect interruption.

Use Effect interruption internally.

Synchronous capabilities that are genuinely synchronous, such as snapshot/subscription interfaces required by React external-store APIs, may remain synchronous.

## 7.4 No Promise round-trip

Remove the current pattern:

```text
Promise adapter
→ MessageChannel
→ Promise adapter
→ Effect.tryPromise
→ Atom
```

Target:

```text
Effect capability
→ MessageChannel adapter
→ Effect capability
→ Atom
```

---

# 8. Rewrite the plugin bridge request engine around Effect

Preserve the current wire protocol unless a wire change is genuinely required.

Do not add a generic cancellation protocol merely because the implementation now uses Effect.

## 8.1 Plugin side

In `packages/client-sdk/src/runtime.ts`, replace manually constructed request Promises with `Effect.async` or an equivalent Effect primitive.

The pending-request table should store Effect completion callbacks/state rather than Promise `resolve`/`reject`.

For each request:

1. validate runtime/session state;
2. allocate the request id;
3. enforce the existing pending-request limit;
4. register completion;
5. post the existing wire request;
6. on an existing supported cancellation path, send the existing cancel message when interrupted;
7. remove completion state exactly once.

Late responses after interruption/disposal must be ignored.

Session closure must fail/interupt every pending capability with the existing semantic client failure.

## 8.2 Kernel side

Change `PluginBridgeOptions` asynchronous handlers from:

```ts
(request, signal) => Promise<Outcome>
```

to Effect-returning handlers.

Run each incoming request as a fiber using the kernel's existing runtime boundary.

The pending map stores fibers/request ownership rather than one `AbortController` per operation.

Existing explicit cancel messages interrupt the corresponding fiber.

Session close/document replacement interrupts all in-flight request fibers.

Operations that currently have no per-request cancel protocol retain that behavior; local/plugin disposal still prevents stale results from being accepted.

## 8.3 Preserve bridge edge cases

Do not regress:

- handshake timeout;
- composition-hash validation;
- malformed message handling;
- duplicate request-id handling;
- maximum pending requests;
- overlay dismissal;
- document replacement;
- entity-interest subscription disposal;
- update/freshness signaling;
- session close;
- stale-session operation behavior;
- Blob upload behavior;
- malformed result validation;
- no bearer credentials/user/server identity crossing the bridge.

Existing E2E client-plugin lifecycle coverage must continue to pass.

## 8.4 Versioning

Because the client authoring API and emitted runtime change:

- bump `CLIENT_API_VERSION` if that constant represents the plugin-facing source API compatibility boundary;
- bump `CLIENT_COMPILER_VERSION` because emitted runtime artifacts change;
- bump the bridge protocol version only if actual wire messages/schemas change.

Do not add old-version decoding.

---

# 9. Make React query/mutation definitions Effect-native

Change `createRyotQuery` and `createRyotMutation` definition callbacks to return Effects instead of Promises.

Query/mutation definitions should compose client operations directly:

```ts
createRyotMutation((context) =>
  Effect.gen(function* () {
    ...
    yield* context.client.operations.invoke(...)
    ...
  }),
);
```

`makeQueryAtom` and mutation atoms should consume those Effects directly rather than wrapping them in `Effect.tryPromise`.

Cancellation comes from the Atom/Effect fiber, not an explicit callback `AbortSignal`.

React itself remains an adapter boundary.

A Promise-returning React convenience such as `mutateAsync` may remain if it is produced by the Atom/React integration and is useful to external callers; it must not be the implementation model underneath the SDK, and first-party code should not build new async orchestration around it.

Move first-party sequential mutation workflows into Effect mutation definitions instead of `async` React event handlers.

## Scheduling

Preserve `RyotSchedule` semantics and TestClock support.

Do not replace the existing Effect Clock-backed scheduling with browser timers.

Update the README text that currently justifies plain asynchronous callbacks on the basis that plugin bundles do not expose Effect.

---

# 10. Migrate plugin authoring APIs and typed failures

## 10.1 Sandbox definition generics

Do not keep:

```ts
Effect.Effect<Output, unknown>
```

in `defineScript`/provider/workflow/operation definition types.

Make the failure type generic and inferred from the supplied implementation.

Conceptually:

```ts
type ScriptExecution<Input, Output, Manifest, Failure> = {
  run: (...) => Effect.Effect<Output, Failure>;
};
```

Apply the same pattern to the other sandbox definition helpers that currently erase failures to `unknown`.

This preserves plugin-author freedom while making error channels statically real.

Do not introduce a mandatory new user-visible sandbox error schema merely to satisfy lint.

## 10.2 First-party typed errors

Within first-party plugin/backend code:

- replace global `Error` values used in Effect failure channels with domain/tagged failures;
- map external-library failures at the adapter boundary;
- do not carry `unknown` through service/script failure channels;
- preserve defects as defects where they truly indicate impossible/programmer failure.

Host capability failures remain `SandboxHostError`.

## 10.3 External libraries

Where plugin code calls a Promise-native external dependency:

```ts
Effect.tryPromise({
  try: ...,
  catch: ...
})
```

must be the boundary.

Do not wrap that returned Effect in another Promise-facing helper.

---

# 11. Migrate first-party plugins

Migrate all three:

```text
plugins/media
plugins/fitness
plugins/fixture
```

Treat host/backend/client separately.

## Backend/sandbox code

- remove `async` application functions;
- replace Promise orchestration with Effect;
- use environment-specific sandbox Effect imports;
- make failure channels typed;
- keep existing sandbox capability/security behavior.

## Client code

- use `@ryot-app/client-sdk/effect` where actual effectful composition is needed;
- convert query/mutation definitions to Effects;
- remove first-party `async` component handlers where orchestration belongs in a mutation;
- keep synchronous rendering/presentation code synchronous.

## Shared code

Do not make shared plugin modules Effect-dependent merely because Effect is available elsewhere.

Keep schema/query/presentation helpers pure when they are naturally pure.

Do not widen `plugin-kit/effect`.

## Tests

Update tests to the new source APIs directly.

Do not keep Promise compatibility helpers for old tests.

---

# 12. Refactor `kernel/client` Layers

Apply the same Layer architecture as the backend.

Current `kernel/client/src/boot/layers.ts` must stop manually providing the same broad infrastructure graph into many services.

Feature layers should own dependencies for:

- auth;
- server/transport;
- navigation;
- plugin catalog/operations/query;
- entity interest;
- managed assets;
- God Mode;
- imports/integrations/notifications;
- saved views/provider add;
- other client features.

`ClientLive` should merge feature-level live layers.

Keep the existing requirement that every Client Layer is synchronously constructible. Do not introduce asynchronous Layer acquisition into React startup.

---

# 13. E2E migration

E2E is part of this work.

Do not change either seed script.

Do not change harness capacity.

## 13.1 Keep existing test execution model

API/browser tests continue to use:

```text
it.live
Effect.gen
effect-playwright
```

Do not switch to `it.effect`.

## 13.2 Convert support infrastructure

Refactor helpers such as `startFakeHttpServer` so the primary API is scoped Effect rather than:

```text
async function
Effect.runPromise
Effect
```

Use `Effect.acquireRelease` directly.

Convert other support/fixture helpers that unnecessarily leave Effect and re-enter it.

## 13.3 Promise boundaries

Enable normal Effect async/Promise diagnostics for E2E code after migration.

Keep narrow exceptions only for genuine boundaries, for example:

- Playwright callback code that executes inside the browser realm;
- third-party APIs that explicitly require Promise callbacks;
- the two untouched seed scripts.

Prefer a local inline suppression with a short reason for isolated browser-realm callbacks rather than a directory-wide exemption.

## 13.4 Seed scripts

Leave these byte-for-byte untouched:

```text
e2e/src/scripts/seed.ts
e2e/src/scripts/seed-client-plugin.ts
```

Their lint exemption may remain permanently scoped to those files.

---

# 14. Sweep every active TypeScript workspace

After the central architecture is migrated, retire the remaining warning scopes from `docs/effect-lint-baseline.md`.

Review all active workspaces, including ones that currently pass, but do not churn clean/pure code for its own sake.

## Apps

### `apps/browser-extension`

Convert internal asynchronous workflows to Effect.

WXT/framework entry callbacks may return `Effect.runPromise(program)` directly rather than being `async`.

### `apps/docs`

Already migrated by the stabilization commit. Keep it green; only update imports/docs affected by moved architecture/build paths.

### `apps/server`

Use Effect for build/dev orchestration.

Apply the script cleanup described below.

### `apps/website`

React Router loader/action functions should delegate to Effect programs.

Where the framework accepts a Promise, use:

```ts
(args) => Effect.runPromise(program(args))
```

rather than making the whole implementation `async`.

Replace Node/global infrastructure usage with Effect/Bun/platform APIs where appropriate.

Do not Effect-ify pure React rendering.

## Kernel

Both backend and client are covered by the main phases.

## Migration

`migrations/v10-rust` stays on the same Effect policy. Do not redesign migration semantics.

## Packages

Explicitly review:

```text
cli
client-plugin-compiler
client-plugin-contract
client-sdk
client-ui-sdk
config
contract
kernel-renderers
plugin-archive
plugin-kit
ryotql
ryotql-recipes
sandbox-compiler
sandbox-sdk
testing
transactional
ts-utils
typescript-compiler
vite-compiler
```

Guidance:

- compiler/build packages may have true platform interop, but internal orchestration should still be Effect;
- testcontainers/child-process/filesystem boundaries should be wrapped once;
- packages that are pure schemas/types/algorithms should remain pure;
- do not introduce Effect merely to satisfy an aesthetic preference.

## Non-Effect trees

Do not migrate or remove:

```text
crates/**
apps/kodi/**
```

Other non-TypeScript CI/assets/docs content changes only if paths or documented architecture changed.

---

# 15. Remove the backend/server script sprawl

The goal is not “no executable entrypoints”; it is clear ownership and no miscellaneous script dumping grounds.

## Final backend layout

Delete:

```text
kernel/backend/scripts/
```

completely.

Generic sandbox runtime-build implementation moves to `packages/sandbox-compiler`.

The remaining kernel-specific build entrypoint lives under:

```text
kernel/backend/build/
```

with a name describing the artifact it builds.

There should be no architecture-check scripts remaining.

## Final server layout

Delete:

```text
apps/server/scripts/
```

Move/consolidate legitimate application build entrypoints into an explicit build area, for example:

```text
apps/server/build/assemble.ts
apps/server/build/sandbox-runtime-image.ts
```

`assemble.ts` continues to own:

- shipped plugin archive copying;
- client runtime compilation;
- kernel renderer compilation;
- `client-image.json`;
- public artifact hashes.

Consolidate runtime cache warming and production sandbox smoke verification behind the sandbox runtime image/build entrypoint rather than maintaining separate generic helper scripts.

Move reusable sandbox process/runtime functionality to its owning package/module instead of `apps/server/run-process.ts`.

## Development entrypoint

Keep at most one server-specific development orchestration entrypoint if the application genuinely needs coordinated rebuild/restart behavior. Put it at an explicit app-owned path such as:

```text
apps/server/dev.ts
```

It is allowed to exist because it represents the server development application, not miscellaneous utility logic.

Do not replace five scripts with five identically purposed files under another directory.

Update package scripts, Turbo inputs, Dockerfile paths, and docs in the same change.

## Preserve production assembly behavior

Do not regress:

- `shipped-plugins.json` as source of truth;
- deterministic plugin archives;
- client artifact hash validation;
- client image generation;
- Deno runtime warm-up;
- Deno runtime smoke verification;
- build-time-only compiler behavior;
- `/home/ryot` production layout.

---

# 16. Tooling enforcement

Once each migration area is clean, remove its temporary warning override immediately.

At the end, `.oxlintrc.json` should contain no migration warning scopes for active application code.

Keep permanent exemptions only for genuine documented boundaries, including the explicitly untouched E2E seed scripts.

Promote the following Effect rules to errors if they are not already errors and the completed codebase passes them without false positives:

```text
effecttsgo/leaking-requirements
effecttsgo/layer-merge-all-with-dependencies
effecttsgo/multiple-effect-provide
effecttsgo/nested-effect-gen-yield
effecttsgo/effect-fn-opportunity
effecttsgo/promise-in-effect-success
effecttsgo/run-effect-inside-effect
effecttsgo/abort-controller-in-effect
```

`async-function`, `new-promise`, typed error rules, global API rules, and the existing correctness rules remain errors.

Keep `strict-effect-provide` at warning unless the repository can enable it as error without requiring entrypoint suppression noise. It is useful as architectural guidance but should not force meaningless annotations around legitimate application roots.

Do not build custom AST tooling for a rule already covered by Effect/Oxlint.

---

# 17. Documentation and `AGENTS.md`

Update documentation during each architectural phase rather than leaving it until the end.

## Root `AGENTS.md`

Add only stable rules similar to:

```text
- Application-owned asynchronous work uses Effect; native Promises belong only at explicit platform/framework boundaries.
- Service implementation dependencies are resolved by Layers and must not leak through service method requirements.
- Reusable effectful functions use Effect.fn/Effect.fnUntraced; Effect.gen is for local control flow and pipes for short transformations/decorators.
- Feature modules own canonical Layer wiring; composition roots combine feature Layers.
```

Do not copy Effect documentation into `AGENTS.md`.

## Backend documentation

Update `kernel/backend/AGENTS.md`:

- repositories use `DatabaseSession`, not ambient `Database`;
- service-owned transaction rules;
- shared transaction behavior;
- remove references to `architecture:check`;
- document that historical backup persistence is structurally isolated instead of checker-enforced;
- document feature-owned Layers.

Update affected module READMEs.

## Client documentation

Update:

```text
kernel/client/README.md
kernel/client/AGENTS.md
packages/client-sdk/README.md
packages/client-sdk/AGENTS.md
packages/client-plugin-contract/README.md
packages/client-plugin-compiler/README.md
```

Document the Effect-native client capability model and the Promise/framework adapter boundary.

## Sandbox/plugin documentation

Update plugin-kit/sandbox compiler/runtime docs for:

- inferred typed failure channels;
- runtime-build ownership move;
- Effect environment-specific imports;
- unchanged neutral plugin-kit surface.

Update first-party plugin READMEs where their authoring examples change.

## E2E docs

Update `e2e/README.md`/`AGENTS.md` to describe the narrower Promise exceptions.

Do not change the seed-script guidance.

## Lint baseline document

As overrides disappear, update `docs/effect-lint-baseline.md`.

When the migration is complete and only permanent explicit exceptions remain, delete this temporary migration document and move any stable policy worth preserving into the appropriate `AGENTS.md`/README.

---

# 18. Required regression coverage

Do not rely solely on lint success.

## Backend

Run focused tests after each affected vertical slice.

Before completion, cover:

- DatabaseSession transaction propagation;
- entity lifecycle writes;
- relationship lifecycle writes;
- collection membership writes;
- event writes;
- automation planning/dispatch;
- plugin install/update/uninstall;
- backup export/restore;
- sandbox execution;
- migrations;
- authentication and user bootstrap.

## Client/plugin

Cover:

- bridge handshake;
- operation request;
- RyotQL request and cancellation;
- asset resolution and cancellation;
- collection mutation;
- upload;
- storage;
- document replacement;
- bridge disposal;
- entity interest;
- page refresh;
- stale plugin revision;
- malformed bridge output;
- pending request limit;
- plugin crash/reload;
- theme/navigation/viewport propagation.

## Compilers/build

Verify deterministic output and hashes.

Changing source organization must not silently change an artifact hash unless the emitted artifact itself actually changed.

Bump the relevant compiler/API version when emitted bytes or source compatibility do change.

## E2E

Do not alter test capacity.

Run the standard suite according to `e2e/README.md`.

For final acceptance, standard E2E files should pass independently as documented.

Do not run opt-in operational/live-provider gates unless the changed code specifically warrants them.

---

# 19. Final repository acceptance criteria

The work is complete only when all of the following are true.

### Database

- no application code imports the old `Database` service;
- no application code dynamically `provideService`s a database transaction;
- repositories automatically use the current DatabaseSession executor;
- nested service-owned transactions retain the intended rejection semantics.

### Services

- normal public service methods do not leak implementation services;
- caller-side dependency-provision helpers such as `provideMutation` are gone;
- large service implementations have sensible internal seams rather than nested lexical mazes.

### Layers

- backend and client boot Layers are composition roots;
- feature/service layers own their dependencies;
- no application Layer graph depends on the current duplicate-layer `Layer.fresh` workaround;
- the custom duplicate-layer checker is gone.

### Effect style

- migration scopes are clean for nested generators and reusable `Effect.gen` wrappers;
- pipes remain where they improve readability;
- no mechanical “replace every pipe with `Effect.gen`” refactor has occurred.

### Client/plugins

- core asynchronous client capability APIs are Effect-native;
- the bridge does not create manual request Promises;
- bridge cancellation/lifecycle uses fibers/interruption;
- React is an adapter over Effect rather than the reason the core API is Promise-based;
- sandbox definition types do not erase failures to `unknown`;
- first-party plugins use typed Effect failures.

### Tooling

- `bun turbo --output-logs=full check` passes;
- temporary warning overrides have been removed from migrated code;
- only narrow permanent interop/seed exceptions remain;
- generic Effect architecture is enforced by `@effect/tsgo`/Oxlint rather than custom scripts.

### Scripts/build

- `kernel/backend/scripts` no longer exists;
- `apps/server/scripts` no longer exists;
- legitimate build/dev entrypoints have explicit owners;
- sandbox runtime build logic belongs to the sandbox compiler/build subsystem;
- server assembly still produces identical required production artifacts and validation.

### E2E

- Effect-native support/fixtures remain scoped correctly;
- Promise exceptions are narrow;
- seed scripts are untouched;
- load-sensitive harness configuration is unchanged.

### Documentation

- no documentation references removed architecture checks, old Database transaction injection, old Promise-based client APIs, or old build-script paths;
- root/child `AGENTS.md` files contain only concise stable guidance.

---

# 20. Verification sequence

After every major phase:

```bash
bun turbo --output-logs=full check
```

Run affected package tests immediately.

Periodically run:

```bash
bun turbo --filter='!@ryot-app/e2e' --output-logs=full test
```

Before final completion:

```bash
bun turbo --output-logs=full check
bun turbo --filter='!@ryot-app/e2e' --output-logs=full test
bun turbo --filter=@ryot-app/e2e test
```

Run standard E2E files individually as required by `e2e/README.md` if the aggregate run reports cross-file failures.

Inspect the final `.oxlintrc.json` manually and verify that no temporary migration override remains merely to make CI green.

Also search the final tree for at least:

```text
provideService(Database
yield* Database
transactionService
Layer.fresh(
new Promise(
Effect.Effect<..., unknown>
async (
architecture:check
kernel/backend/scripts
apps/server/scripts
```

Each remaining hit must be either absent or demonstrably an intentional external/framework/test-seed boundary covered by the final architecture and lint policy.

Do not finish with TODOs, compatibility paths, deprecated APIs, or “temporary” architecture exceptions.