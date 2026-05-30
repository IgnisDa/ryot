# God Mode Admin Operations

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate god-mode admin operations through the Effect contract and admin middleware. This includes user listing, provisioning, password reset flow support, and ban state updates. The route surface should preserve admin token behavior and use direct success values plus typed errors.

This slice depends on Better Auth, admin middleware, user schema, and bootstrap behavior.

## Acceptance criteria

- [ ] Admin token enforcement works for every god-mode route
- [ ] Admins can list users with expected account metadata
- [ ] Admins can provision users as supported by current product behavior
- [ ] Admins can generate/reset password flows as supported by current product behavior
- [ ] Admins can set and clear user ban state
- [ ] God-mode E2E tests pass through the Effect client or raw fetch where auth edge cases require it

## User stories addressed

Reference by number from the parent PRD:

- User story 13
- User story 41
- User story 48
- User story 59
