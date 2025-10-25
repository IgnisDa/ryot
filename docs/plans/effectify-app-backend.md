# Effectify `app-backend` — applying the Effect-TS skills

## Goal

Apply the [Effect-TS skills](https://github.com/Effect-TS/skills) to `apps/app-backend`
to make it cleaner and more idiomatic.

## Critical constraint: skills target `effect@beta`, we run stable

The skills are written for **`effect@beta` / `effect-smol`**. Every guide assumes a vendored
`./.repos/effect` (smol) and prescribes APIs that exist only in the beta line
(`effect/unstable/sql`, `effect/unstable/http`, `Context.Service`, `Schema.TaggedErrorClass`,
`Schema.Class`-curried layers, `Layer.effect` replacing `Layer.scoped`, `Schema.decodeUnknownEffect`, …).

`app-backend` deliberately runs **stable Effect 3.21.3** with the mature ecosystem
(`@effect/sql-pg`, `@effect/platform(-bun)`, `@effect/cluster`, `@effect/workflow`, `@effect/vitest`,
`better-auth`). Several have **no beta-parity equivalent yet**.

**Decision (confirmed with maintainer):** apply the skills' _version-agnostic principles_ to the
current stable codebase. **No dependency or Effect-version changes.** The build (`tsc + oxfmt + oxlint`)
and tests stay green throughout.

## Current state

The codebase is already heavily, cleanly Effect-native: `Effect.Service` classes (41), layer-based DI,
`Schema.TaggedError` typed errors (15), Effect Schema for all payloads, a transaction runner,
`Schedule`-based polling, `@effect/vitest`. TS hygiene is already strong: **0 `any`, 0 `namespace`**, and
the `as` casts are nearly all import-aliases / empty-array widenings.

So this is **not a rewrite** — it is one systematic adoption plus a few targeted cleanups.

## Principle → stable mapping

| Skill principle                                             | Stable equivalent                          | Status / action                                             |
| ----------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `Effect.fn` for reusable business ops (spans, stack frames) | `Effect.fn` (exists in 3.21.3)             | **0/419 — primary gap. Adopt.**                             |
| Typed errors, schema-backed                                 | `Schema.TaggedError`                       | ✅ already done                                             |
| Wrap foreign errors, no leakage                             | `Effect.try`/`tryPromise` + typed error    | mostly ✅; 6 raw `try/catch` left in `integrations/sinks/*` |
| DI via services/layers, provide at edge                     | `Effect.Service` + `HttpApiBuilder` groups | ✅ already done                                             |
| No thin accessor wrappers                                   | services called directly from routes       | ✅ already done                                             |
| `Schedule` over manual retry loops                          | `Schedule` + `Effect.repeat`/`retry`       | ✅ already done (no manual retry recursion found)           |
| No `any` / `as` / `namespace`                               | narrowing, schema decode, predicates       | ✅ strong; 1 genuine boundary cast in `errors.ts`           |
| Schema `Class`/`TaggedClass` over `Struct` for named models | `Schema.Class` etc.                        | ⚠️ **deliberately deferred** — see Out of scope             |
| `@effect/vitest` `layer()` over local `Effect.provide`      | `layer()` / `it.layer`                     | partial — see Phase 3                                       |
| `assert` over `expect` in Effect tests                      | `assert`                                   | ⚠️ **deliberately not churned** — see Out of scope          |

## Phases

### Phase 1 — `Effect.fn` adoption (headline, highest value, low risk)

Convert reusable effectful operations from `(args) => Effect.gen(…)` to
`Effect.fn("Qualified.name")(function* (args) { … })`:

- **Public service methods** → named span `"<Service>.<method>"`.
- **Public repository methods** → named span `"<Repository>.<method>"`.
- **Module-private value-returning effectful helpers** → `Effect.fn` **without** a span name (keeps
  stack frames, avoids span noise — the skill's recommended middle ground).
- **Leave alone:** pure (non-Effect) helpers; inline `Effect.gen` composition blocks inside an
  `Effect.fn`; route handlers (thin boundary `Effect.gen` is correct); top-level layer assembly.

> **Void-success guard nuance.** The `@effect/language-service` `missingReturnYieldStar` rule requires
> `return yield* <failingEffect>`, which collides with oxlint `consistent-return` only when a generator's
> success type is `void` (one path returns `never`, the happy path returns nothing). The codebase already
> resolves this by writing void guards/validators as **plain arrows returning an Effect**
> (`Effect.void` / a typed failure), e.g. `QueryEngineService.validateSavedView`. So: keep void-success
> guards as plain `(args) => Effect` functions; reserve `Effect.fn` for value-returning ops and multi-step
> workflows. `check` catches any conflict per module.

Why: this is the skills' #1 rule across the effect/observability guides, fully supported on stable,
and shape-preserving (service interfaces and test mocks are unchanged), so it lands without ripple.

Sequence: pilot module → sweep module-by-module (one logical commit per module group), running
`@ryot/app-backend check` + that module's test after each.

### Phase 2 — targeted hygiene

- Replace the 6 raw `try/catch` in `modules/integrations/sinks/{emby,jellyfin,plex,kodi,browser-extension}.ts`
  with `Effect.try`/`Effect.tryPromise` (per AGENTS.md "prefer Effect's exception-capture primitives").
- Replace the one genuine boundary cast in `lib/errors.ts` (`cause as PgErrorLike`) with a typed predicate.
- Review (not necessarily change) `[] as ReadonlyArray<T>` widenings — keep where they are the cleanest
  empty-literal expression.

### Phase 3 — test ergonomics (conservative; flaky-suite aware)

- Where multiple tests in a file already share **one identical** layer, hoist to `@effect/vitest`
  `layer(...)`. Keep per-test distinct-mock layers as local `Effect.provide` (a legitimate one-off per the
  testing guide).
- Do **not** mass-rewrite the integration suite (known shared-backend flakiness).

## Out of scope / deliberately NOT doing (and why)

- **Migrating to `effect@beta`** — large breaking rewrite, no beta parity for sql-pg/cluster/workflow/better-auth.
- **Blanket `Schema.Struct` → `Schema.Class`** — these are HTTP request/response DTOs wired into `HttpApi`
  and consumed across app + client via `.Type`; converting changes `.Type` to instance types with broad
  blast radius and little payoff. The skill itself keeps `Struct` for "inline request/response shapes."
  Revisit only for genuine named domain models if any emerge. (YAGNI.)
- **Blanket `expect` → `assert`** — soft skill preference; existing `expect` is idiomatic vitest. Not worth the churn.

## Acceptance per module

- `bun turbo --filter=@ryot/app-backend check` passes (tsc + oxfmt + oxlint).
- `cd apps/app-backend && bun run test <module>` passes.
- No behavior change; diffs are mechanical (constructor shape + span names).

## Pilot

`modules/saved-views` (service + repository; routes/schemas/tests need no change). Demonstrates the
Phase-1 transformation end-to-end for review before the sweep.
