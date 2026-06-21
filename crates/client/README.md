# App Client

Expo client for Ryot. Backend-backed features follow one dependency direction:

```text
route or screen
  -> feature state or hook
  -> scoped query atom
  -> appClient(ApiScope)
  -> @ryot-app/contract
```

## Backend Integration

`appClient(scope)` is the kernel client boundary for both reactive queries and imperative contract access. Authenticated feature operations receive `ApiScope`, not a raw server URL. Origin normalization, transport, and contract-client construction remain in `src/api`.

- Public clients call unauthenticated endpoints such as health and system configuration without hidden retries.
- Authenticated clients attach the current cookie, use browser credentials, and apply bounded retries to queries only.
- Admin clients add the admin token without storing it in process-wide state.
- Entity-interest streaming uses Expo Fetch through the same authenticated request policy.
- Query retries and focus/reconnect revalidation are centralized in the shared query boundary.

Feature modules own their request documents, atoms, decoders, typed application states, and mapping
from transport categories and module-owned reasons. Presentation code consumes states such as
`loading`, `ready`, `not-found`, or `malformed`; it does not inspect generic contract rows or Effect
causes.

States produced through `classifyRyotQLResult` derive their shared loading and failure variants with `MappedRyotQLResultState`. Feature state types add only their domain-specific ready, empty, or unavailable variants instead of copying the transport state shape.

## Cache Identity

Authenticated data is scoped by `ApiScope` from `src/api/request-key.ts`:

```ts
type ApiScope = { serverUrl: string; userId: string };
```

The server origin is normalized before keying. Include request-specific inputs after this scope, and use scoped reactivity keys for mutations. Do not create authenticated atoms with a missing user ID.

Admin flows have no user ID, so they are scoped by `AdminSession` from `src/api/admin-api.ts`:

```ts
type AdminSession = { serverUrl: string; sessionId: string };
```

The session identifier is opaque and generated per unlock. The admin access token lives only in the api-layer session registry that the admin request layer reads per request, so it never enters an atom, an atom key, or persistence. Clearing a session removes the token, which makes any in-flight or cached admin atom fail as unauthorized without needing atom teardown.

## Persistence

The shared adapter under `src/persistence` stores only `ryot:`-prefixed application keys. Persisted atoms remain in their owning feature.

Current scopes:

| State               | Scope                  |
| ------------------- | ---------------------- |
| Server URL          | Global                 |
| Theme               | Global                 |
| Workspace selection | Server and user        |
| Saved-view layout   | Server, user, and view |

Storage clearing removes only Ryot-owned keys. Auth storage is cleared through the auth module.

## Managed Assets

Feature state collects local and S3 locators, while `ManagedAssetHost` resolves their URLs and provides them through context. Nested hosts merge their URLs with the parent context so lazily loaded sections can add assets without hiding or re-resolving the screen's existing assets. Remote locators continue to resolve directly without entering the managed request.

## Mobile Navigation

Mobile headers are driven by route role: workspace homes and saved views use the drawer menu, while entity details and settings use stack back navigation. Workspace switching resets the stack and in-memory saved-view search and scroll state. Saved-view state is keyed by view inside the active workspace so detail navigation and sibling-view changes can restore the source list.

## Errors

Feature state maps the typed transport category and module-owned reason to stable, client-owned
copy. Internal causes and raw compiler/runtime diagnostics are not rendered or serialized into
normal application UI.

`src/api/request-failure.ts` owns that mapping. Decode the contract failure, use exhaustive Effect
`Match` over its transport category and module-owned reason, and use the structured parameters for
the title, detail, and recovery action. Reason codes are stable wire identifiers, not display text;
feature code must not extract or interpret backend messages.

## Plugin Catalog Flows

Import sources and integration providers are both catalogs of services contributed by server-side plugins, configured through a schema the server declares. They share their machinery rather than duplicating it:

- `src/modules/ui/plugin-catalog/` — `CatalogEntry` is the normalized row both features map onto; `groupCatalogEntries` handles grouping by plugin, search and sorting, and `CatalogPicker` renders the list along with its loading, error and empty states. A feature supplies only a `toEntry` mapping, a `chooseLabel`, and its own copy.
- `src/modules/ui/wizard/` — the pick → configure → review state machine and the wizard chrome. Steps are named generically; features supply their own headings.
- `src/modules/ui/search-param-modal.tsx` — keeps a full-screen flow in the URL so native back and web history close it. Use it for any flow that would otherwise hold open/closed state in a component.

A feature module keeps only what is genuinely its own: the domain type it lists, how a row maps onto a `CatalogEntry`, the copy, and the request payload it builds.

## Section Navigation

Sections such as settings and god mode share one set of primitives instead of each owning a sidebar:

- `src/modules/ui/sections.ts` — `SectionNavItem` and `activeSectionSlug`, the dependency-free route matcher.
- `src/modules/ui/section-nav.tsx` — `SectionNavList` for the nav rows and `SectionSidebarLayout` for the persistent desktop sidebar.
- `src/modules/ui/section-frame.tsx` — `SectionFrame`, the titled content frame; prose sections keep the default reading width and data views widen it.
- `src/modules/ui/search-field.tsx`, `src/modules/ui/pagination.tsx`, `src/modules/ui/use-debounced-search.ts`, `src/modules/ui/row-action-menu.tsx` — the shared search field, load-more control, debounced search state, and per-row action menu (a bottom sheet on native, an anchored popover on web).

A feature contributes only its section array and its screens.

## God Mode

God mode is server administration, so it sits outside the authenticated shell and unlocks with an admin access token rather than a user session. `GodModeGate` owns that lifecycle: it renders the token form while locked, registers the session with the api layer on unlock, and provides the session scope to its routes. Any unauthorized response relocks it.

The user list uses TanStack-controlled load-more state with manual global filtering and pagination. Each successful server page remains in an independent fifty-row atom keyed by session, search term, and offset. Load-more mounts the next page rather than growing a single request, so previously loaded rows are never refetched, and a lifecycle mutation invalidates every loaded page through the shared reactivity key.

## Entity Interest

The provider owns the authenticated stream lifecycle. The coordinator unions mounted interests, sends replace-style declarations sequentially, retries the latest declaration with bounded backoff, and cancels stale work when the stream, server, user, or provider changes.

## Adding A Backend Feature

1. Build the application-owned query document with `@ryot-app/ryotql` or a named `@ryot-app/ryotql-recipes` recipe.
2. Pass `ApiScope` to the feature operation and use `appClient(scope)` for reactive queries or imperative contract access.
3. Add a feature-owned atom keyed by `ApiScope` and all request inputs.
4. Decode the response beside the recipe or feature atom into a discriminated application state.
5. Expose a feature hook or component that supplies state and actions to the route.
6. Test cache partitioning and application-state branches; use backend integration tests for protocol behavior.

Use these commands for local validation:

```sh
bun turbo --filter=@ryot-app/kernel-client test
bun turbo --filter=@ryot-app/kernel-client check
bun turbo --filter=@ryot-app/kernel-client build
```
