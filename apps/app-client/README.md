# App Client

Expo client for Ryot. Backend-backed features follow one dependency direction:

```text
route or screen
  -> feature state or hook
  -> scoped query atom
  -> appClient(ApiScope)
  -> @ryot/contract
```

## Backend Integration

`appClient(scope)` is the app-client boundary for both reactive queries and imperative contract access. Authenticated feature operations receive `ApiScope`, not a raw server URL. Origin normalization, transport, and contract-client construction remain in `src/api`.

- Public clients call unauthenticated endpoints such as health and system configuration without hidden retries.
- Authenticated clients attach the current cookie, use browser credentials, and apply bounded retries to queries only.
- Admin clients add the admin token without storing it in process-wide state.
- Entity-interest streaming uses Expo Fetch through the same authenticated request policy.
- Query retries and focus/reconnect revalidation are centralized in the shared query boundary.

Feature modules own their request documents, atoms, decoders, and typed application states. Presentation code consumes states such as `loading`, `ready`, `not-found`, or `malformed`; it does not inspect generic contract rows or Effect causes.

## Cache Identity

Authenticated data is scoped by `ApiScope` from `src/api/request-key.ts`:

```ts
type ApiScope = { serverUrl: string; userId: string };
```

The server origin is normalized before keying. Include request-specific inputs after this scope, and use scoped reactivity keys for mutations. Do not create authenticated atoms with a missing user ID.

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

## Mobile Navigation

Mobile headers are driven by route role: workspace homes and saved views use the drawer menu, while entity details and settings use stack back navigation. Workspace switching resets the stack and in-memory saved-view search and scroll state. Saved-view state is keyed by view inside the active workspace so detail navigation and sibling-view changes can restore the source list.

## Errors

Feature state maps transport and decoder failures to stable user-facing copy. Internal causes may be logged for diagnosis, but must not be rendered or serialized into the UI.

## Entity Interest

The provider owns the authenticated stream lifecycle. The coordinator unions mounted interests, sends replace-style declarations sequentially, retries the latest declaration with bounded backoff, and cancels stale work when the stream, server, user, or provider changes.

## Adding A Backend Feature

1. Build the application-owned query document with `@ryot/ryotql` or a named `@ryot/ryotql-recipes` recipe.
2. Pass `ApiScope` to the feature operation and use `appClient(scope)` for reactive queries or imperative contract access.
3. Add a feature-owned atom keyed by `ApiScope` and all request inputs.
4. Decode the response beside the recipe or feature atom into a discriminated application state.
5. Expose a feature hook or component that supplies state and actions to the route.
6. Test cache partitioning and application-state branches; use backend integration tests for protocol behavior.

Use these commands for local validation:

```sh
bun turbo --filter=@ryot/app-client test
bun turbo --filter=@ryot/app-client check
bun turbo --filter=@ryot/app-client build
```
