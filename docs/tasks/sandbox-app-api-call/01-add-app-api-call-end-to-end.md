# Add `appApiCall` End-to-End

**Parent Plan:** [sandbox-app-api-call](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Implement the new `appApiCall` host function as the end-to-end replacement for `executeQuery`, using the design in the parent PRD's `Solution`, `Implementation Decisions`, and `Testing Decisions` sections.

This slice should deliver a complete authenticated path from sandbox script execution through the backend app route surface, including the in-process request executor, the in-memory internal auth bridge, removal of `executeQuery`, and the related sandbox documentation updates describing the new host function and auth model.

## Acceptance criteria

- [ ] Sandbox scripts can call authenticated routes mounted on the app-owned backend route surface through `appApiCall(method, path, options?)`.
- [ ] Internal sandbox API auth uses the in-memory request registry model from the parent PRD and does not expose reusable credentials to sandbox code.
- [ ] `executeQuery` is removed completely from the sandbox host-function surface, registry, and tests.
- [ ] Backend unit tests and end-to-end tests cover successful `appApiCall` execution, route-path normalization, rejection of auth override headers, and authenticated execution as the owning user.
- [ ] Related sandbox documentation is updated to describe `appApiCall`, its scope, and the internal auth model.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 6
- User story 7
- User story 8
- User story 9
- User story 18
- User story 19
- User story 20
- User story 21
- User story 23
- User story 24
