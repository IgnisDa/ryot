# Plugin Kit

`@ryot-app/plugin-kit/manifest` owns plugin authoring schemas and types. `definePlugin` preserves
literal types while validating the strict authored manifest: every section is required, empty arrays
are explicit, unknown fields are rejected, and `scripts` is not authored. Sandbox slugs use lowercase
letters and numbers separated by `.`, `_`, or `-`; `/` is reserved for path mapping.

## Package Layout

| Root       | Archived | Owner and allowed dependencies                                                     |
| ---------- | -------- | ---------------------------------------------------------------------------------- |
| `host/`    | No       | Manifest and code imported directly by the server or kernel client                 |
| `backend/` | Yes      | Sandbox entrypoints and libraries; may import siblings and `shared/`               |
| `client/`  | Yes      | Optional client plugin; may import siblings and `shared/`                          |
| `shared/`  | Yes      | Environment-neutral `.ts`; may import shared siblings and plugin-kit neutral shims |

Archived roots never import `host/`. Production host code reaches archived backend code only through
`backend/contracts/**`, which holds sandbox-owned schemas, recipes, and helpers needed by host callers.
Nothing host-only belongs under an archived root.

Backend areas group entrypoints under `automations/`, `bootstrap/`, `imports/`, `integrations/`,
`operations/`, `workflows/`, and `providers/`; cross-area code belongs in `backend/lib/`.

Provider entrypoints use:

```text
backend/providers/<provider slug path>/<operation>.sandbox.ts
```

The path is the provider slug with `/` replacing `.`, and the basename is `details`, `search`,
`search-options`, `resolve`, or `translate`. Other sandbox basenames in a provider directory are
provider-associated ordinary scripts.

## Script Discovery

Every `backend/**/*.sandbox.ts` file is an entrypoint. `ryot plugin build` reads its direct definition
and derives `scripts`, including entry path and provider identity, into archive `manifest.json`.
Installation recomputes that list from sources and rejects disagreement, so editing archive metadata
cannot widen a script. Renaming a script slug requires updating all manifest references.

Each entry default-exports exactly one direct definition with static manifest, input schema, output
schema, and Effect-returning `run`. The static manifest is the source of its metadata; there are no
driver maps or runtime kind selection.

| Kind         | Helper             | Use                                                             |
| ------------ | ------------------ | --------------------------------------------------------------- |
| `script`     | `defineScript`     | Boot, cron, bootstrap, or internal execution                    |
| `operation`  | `defineOperation`  | Public `plugins.invoke` entrypoint                              |
| `workflow`   | `defineWorkflow`   | Deterministic durable orchestration; capabilities must be empty |
| `automation` | `defineAutomation` | Policy or subscription binding                                  |
| `provider`   | `defineProvider`   | One logical provider operation                                  |

A logical provider requires `details` and may declare `search`, `resolve`, and `translate`, each as a
separate provider script. `rootEntitySchemaSlug` may reference an entity schema from the same plugin.
User-effective provider and schema resolution includes ready private installations only for their
owner; APIs without user context resolve system definitions only. Persisted provenance uses stable
plugin ID, not installation ID.

## Shared Sources

`shared/**` accepts `.ts`, not `.tsx`. Its only bare imports are
`@ryot-app/plugin-kit/effect`, `/ryotql`, and `/schema`; relative imports remain inside `shared/`.
Client and sandbox compilers enforce the same rule and reject client-only or sandbox-only SDK imports.

The `ryotql` shim exports RyotQL, `IsoDateString`, and the four event expression helpers. It must not
re-export `@ryot-app/ryotql-recipes`, which brings in the contract runtime. The `effect` shim exports
only `DateTime`, `Option`, `Result`, `Schema`, and `SchemaGetter`. Backend compilation aliases these
neutral shims to existing runtime modules where possible to avoid charging duplicate libraries to
each script's 1 MiB budget.

Only sources reachable from a declared client or sandbox entry are checked. A plugin with no client
entry can therefore leave otherwise unreachable shared files unchecked.

## Manifest Sections

| Section                | Purpose                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `metadata`             | Package slug, name, description, version, and icon          |
| `configSchema`         | Plugin-owned environment configuration                      |
| `scripts`              | Build-derived sandbox entries and requirements              |
| `providers`            | Logical providers mapped to provider-operation scripts      |
| `workflows`            | Public workflow slugs                                       |
| `operations`           | Public user- or integration-authenticated operations        |
| `boot`                 | Restart-time system-subject dispatches                      |
| `userBootstrap`        | Per-user bootstrap dispatches for system plugins            |
| `crons`                | Scheduled system-subject dispatches                         |
| `importSources`        | Payload, single-file, or named-file workflow inputs         |
| `httpRateLimits`       | Deployment-global limits by normalized HTTP(S) origin       |
| `integrationProviders` | Push, sink, or yank integrations                            |
| `entitySchemas`        | Entities, events, user-state policy, and merge identity     |
| `relationshipSchemas`  | Typed relationship endpoints                                |
| `signalSchemas`        | Signal audience, catalog, and formatter definitions         |
| `savedViews`           | Plugin-owned query documents and display configuration      |
| `bindings`             | Entity, event, relationship, and signal automation bindings |

All referenced scripts, workflows, providers, and config keys must exist. Active plugins share the
global namespaces enforced by `PluginManifest`. Entity and relationship schema evolution is additive.

## Subject And Capabilities

Ingestion assigns plugin scope (`system` or `user`); manifests do not. Execution subject identifies
whose data an invocation uses and does not widen plugin privilege. Kernel dispatch selects it, never
script input. User plugins cannot declare `boot`, `userBootstrap`, or `httpRateLimits`, or use a system
plugin slug.

`capabilities` is an allowlist request, not a grant. The backend intersects it with host functions and
policy for script kind, subject, plugin scope, provider association, and bootstrap designation. Domain
modules still enforce ownership. Declare only used methods. `artifact-read` and `scratch` request
filesystem grants. Workflows declare no capabilities and receive durable replay primitives only.

Subject follows the dispatch path: boot and cron use system; user bootstrap uses the initialized user;
user operations, imports, and user-triggered provider calls use the caller; integration operations add
validated integration context; automations use their subscription subject; durable descendants inherit
their parent's subject.

Exact host-function and filesystem limits are in the
[sandbox runtime reference](../../kernel/backend/src/lib/infrastructure/sandbox-runtime/README.md).

Prefer bounded batch host calls. Do not hide N+1 bridge traffic behind concurrency: each execution has
a host-call budget and at most four calls may be in flight.

Provider-associated scripts share cache namespace by logical provider ID. Standalone scripts use
immutable script ID. Both are isolated by executing user, not plugin owner. Exact key, TTL, and restart
semantics are in the sandbox runtime reference.

## HTTP Rate Limits

Every manifest includes `httpRateLimits`, using `[]` when empty. Each declaration has a lowercase
slug `key`, positive safe-integer `requests` and `intervalMs`, and a non-empty list of HTTP(S) origins.
Origins contain no path, query, fragment, credentials, or wildcard and are normalized before unique
key and origin checks.

Limits are deployment-global, not per plugin, script, user, or credential. Identical declarations can
coexist; conflicting declarations sharing a key or origin reject the prospective active snapshot.
Matched traffic uses an evenly spaced global schedule with no burst reservation. A generic HTTP 429
retries durably after valid `Retry-After`, otherwise after the declaration interval. Unmatched origins
are not constrained by this limiter.

## Durable Workflows

Workflow modules orchestrate only `activity`, `sleep`, and child-workflow calls. Call order, names,
slugs, inputs, and app-owned child execution IDs must remain deterministic across replay. Exactly one
durable owner may create each execution. Move ambient time, randomness, network, filesystem, mutable
state, and ordinary host functions into activity scripts. Use `Effect.fail` for expected failures.
Runtime pinning and replay semantics are in the
[sandbox runtime reference](../../kernel/backend/src/lib/infrastructure/sandbox-runtime/README.md#durable-state).

## Installation Lifecycle

Ingestion validates a complete prospective registry, compiles entries, persists immutable
content-addressed scripts, and atomically swaps the active snapshot. Readers see a complete old or new
snapshot. Existing durable workflows retain pinned versions; new resolution uses the active snapshot.

System plugins are deployment-controlled. User plugins can be uninstalled only when no workflow,
entity, active schema, or binding references them. Callers may retry while an active workflow reaches
terminal state; persistent references require explicit removal.

## Configuration And Data Contracts

`configSchema` is strict top-level `AppSchema` data with string, number, integer, boolean, or enum
fields. It supports labels, descriptions, secrets, defaults, and ordinary validation, but not nested
values, arrays, dates, translation, normalization, or schema rules. Script and import-source config
requirements must name declared fields. Scripts declare host-owned configuration separately.

Numeric `normalize.round.scale` in other manifest property schemas applies half-up rounding before
validation.

`mergeIdentityProperties` names unique top-level entity properties whose persisted JSON values must
match before user state can merge. Omission means no property-based merge restriction.

Crons target one script and use either `{ cron }` or `{ tier: "infrequent" }`. Boot entries target one
script and run once per server start. Both run with system subject through durable execution; dispatch
is skipped when `scheduler.disableDispatchers` is enabled. Boot scripts must be idempotent.

Operations map a public slug and `user` or `integration` auth to an `operation`-kind script. Import
sources map strict input schemas to workflows. Uploads are top-level string fields with upload format;
the kernel validates each file and exposes it by field name for `readNamedArtifact(key)`. Payload-only
sources use ordinary fields.

## Recipes

`@ryot-app/plugin-kit/operations` provides an Effect-based typed operation invoker.
`defineOperationRecipe` pins plugin slug, operation slug, and input/output Effect Schemas;
`invokeOperationRecipe` encodes input, calls the supplied transport, and decodes output.
