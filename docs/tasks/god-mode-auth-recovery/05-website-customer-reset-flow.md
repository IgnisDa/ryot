# Website Customer Reset Flow

**Parent Plan:** [God Mode Auth Recovery](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add the cloud customer-scoped reset link path on the website account page. Authenticated website customers with an associated app user should be able to request a reset link for their own app account. The website must call the backend god-mode reset endpoint server-side using `SERVER_ADMIN_ACCESS_TOKEN`, and the backend remains the source of truth for local-auth-disabled, OIDC-only, and mixed-auth restrictions.

This is not a general cloud admin UI. It is scoped to the logged-in customer's own app user. OIDC customers must not receive local password reset links.

## Acceptance criteria

- [x] Website account page exposes a reset-link action only when the customer has an associated app user ID
- [x] The website action calls the backend god-mode reset endpoint server-side with the admin bearer token
- [x] The website action only requests reset links for the authenticated customer's own app user ID
- [x] OIDC customers do not receive local password reset links
- [x] Backend god-mode validation errors are surfaced as safe website errors
- [x] The website does not expose `SERVER_ADMIN_ACCESS_TOKEN` to the browser
- [x] The website flow reuses the same backend reset operation as app-client god-mode

## User stories addressed

- User story 19
- User story 20
- User story 27
- User story 28
