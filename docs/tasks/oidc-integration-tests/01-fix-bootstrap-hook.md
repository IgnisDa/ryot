# Fix Bootstrap Hook

**Parent Plan:** [OIDC Integration Tests](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Move `bootstrapNewUser` out of the email sign-up route and into a Better Auth `databaseHooks.user.create.after` hook so that every newly created user — regardless of sign-up method — is bootstrapped automatically.

Currently the email sign-up route handler calls `bootstrapNewUser(userId)` explicitly after `auth.api.signUpEmail` succeeds. OIDC users created through the Better Auth callback receive no bootstrap call at all, leaving them with an empty account (no trackers, no saved views, no library entity). This is the bug described in the "Bug fix" section of the PRD.

### What to change

**Auth instance module** — extend the `betterAuth({})` call with a `databaseHooks` block:

```
databaseHooks: {
  user: {
    create: {
      after: async (user) => bootstrapNewUser(user.id)
    }
  }
}
```

The hook fires after the user row is committed for any creation path: email sign-up, OIDC callback, and any future provider.

**Email sign-up route handler** — remove the explicit `await bootstrapNewUser(userId)` call and the `userId` variable it depended on. The route becomes: check `disableLocalAuth` → validate name → call `auth.api.signUpEmail` → return success response. Nothing else.

### Circular import check (pre-verified, no action needed)

The four module barrels that `bootstrapNewUser` imports (`collections`, `entity-schemas`, `saved-views`, `trackers`) do not import from the auth library. Importing `bootstrapNewUser` into the auth instance module creates no cycle.

### Atomicity note

The hook runs after the user row is committed. This is not atomic, but it is the same level of atomicity as the previous route-level approach. No regression. The `bootstrapNewUser` function already has an idempotency guard: it checks for an existing tracker row for the user before doing any work, so repeated hook invocations on the same user are safe.

## Acceptance criteria

- [ ] The auth instance module includes a `databaseHooks.user.create.after` hook that calls `bootstrapNewUser(user.id)`
- [ ] The email sign-up route handler no longer contains any call to `bootstrapNewUser`
- [ ] The `userId` variable in the route handler (previously captured from `signUpEmail`'s return value solely to pass to `bootstrapNewUser`) is removed
- [ ] A new email sign-up produces tracker rows in the database (verify manually or via the existing test suite)
- [ ] `bun turbo --filter=@ryot/app-backend check format` passes

## User stories addressed

- User story 8 — first-time OIDC login bootstraps user data
- User story 12 — email sign-up still bootstraps after the refactor
