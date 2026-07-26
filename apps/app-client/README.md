# App Client

Expo client for Ryot. Backend-backed features follow one dependency direction:

```text
route or screen
  -> feature state or hook
  -> scoped query atom
  -> shared API client
  -> @ryot/contract
```

## Backend Integration

`src/api` owns transport policy and contract-client construction:

- Public clients call unauthenticated endpoints such as health and system configuration without hidden retries.
- Authenticated clients attach the current cookie, use browser credentials, and apply bounded retries to queries only.
- Admin clients add the admin token without storing it in process-wide state.
- Entity-interest streaming uses Expo Fetch through the same authenticated request policy.

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

## Errors

Feature state maps transport and decoder failures to stable user-facing copy. Internal causes may be logged for diagnosis, but must not be rendered or serialized into the UI.

## Entity Interest

The provider owns the authenticated stream lifecycle. The coordinator unions mounted interests, sends replace-style declarations sequentially, retries the latest declaration with bounded backoff, and cancels stale work when the stream, server, user, or provider changes.

## Adding A Backend Feature

1. Build the application-owned query document with `@ryot/ryotql` or a named `@ryot/ryotql-recipes` recipe.
2. Add a feature-owned atom keyed by `ApiScope` and all request inputs.
3. Decode the response beside the recipe or feature atom into a discriminated application state.
4. Expose a feature hook or component that supplies state and actions to the route.
5. Test cache partitioning and application-state branches; use backend integration tests for protocol behavior.

Use these commands for local validation:

```sh
bun turbo --filter=@ryot/app-client test
bun turbo --filter=@ryot/app-client check
bun turbo --filter=@ryot/app-client build
```
