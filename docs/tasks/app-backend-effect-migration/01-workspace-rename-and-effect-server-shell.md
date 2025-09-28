# Workspace Rename And Effect Server Shell

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Rename the existing backend so the new Effect backend can own the `@ryot/app-backend` package name without duplicate workspace packages. Create the smallest runnable Effect backend shell with process startup, graceful shutdown, `/api/system/health`, `/api/auth/*` delegation placeholder wiring, `/_i/:integrationId` placeholder routing, and static `./client` SPA fallback behavior.

This slice should prove that the new package can start as the real server target while the old backend remains available only as temporary reference material. Do not migrate domain behavior yet.

## Acceptance criteria

- [x] The old backend directory and package name no longer conflict with `@ryot/app-backend`
- [x] A new `@ryot/app-backend` package starts an Effect-powered server process
- [x] `/api/system/health` returns a successful health response from the new backend
- [x] Unknown non-API paths are served from `./client` with SPA fallback semantics
- [x] `/_i/:integrationId` is reserved by the new server even if behavior is still unimplemented
- [x] The backend check can run for the new package without relying on the old backend package name

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 3
- User story 9
- User story 24
- User story 25
