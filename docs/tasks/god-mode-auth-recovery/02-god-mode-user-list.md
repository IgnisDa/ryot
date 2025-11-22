# God Mode User List

**Parent Plan:** [God Mode Auth Recovery](./README.md)

**Type:** AFK

**Status:** done

## What to build

Create the first god-mode tracer bullet: an admin-token-protected backend user list and an app-client god-mode page that can display it. This proves the new backend module, bearer-token authorization, Better Auth server context usage, OpenAPI contract, generated client consumption, and app-client route shape all work before reset link generation is added.

The backend must use Better Auth server context/adapter for user and account lookup. Do not enable Better Auth's admin plugin. Do not directly read or mutate Better Auth tables for this god-mode operation. The UI must hold the admin token in memory only and must redirect to the existing auth flow if the app client has no configured server URL.

## Acceptance criteria

- [x] A backend god-mode module exists with a user listing endpoint protected by `Authorization: Bearer <SERVER_ADMIN_ACCESS_TOKEN>`
- [x] Incorrect, missing, or malformed bearer tokens are rejected without leaking token details
- [x] The listing endpoint uses Better Auth server context/adapter for users and account lookup
- [x] The listing endpoint returns user ID, name, email, created timestamp, two-factor flag, and auth state
- [x] Auth states are classified as `credential`, `oidc`, `none`, or `mixed`
- [x] Account IDs, OIDC subjects, tokens, passwords, scopes, and provider secrets are not returned
- [x] App-client god-mode route accepts an admin token, keeps it in React memory only, and displays the user list
- [x] App-client god-mode route redirects to auth when no server URL is configured
- [x] Backend unit tests cover bearer token parsing and auth-state classification

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 5
- User story 6
- User story 10
- User story 27
- User story 29
- User story 30
