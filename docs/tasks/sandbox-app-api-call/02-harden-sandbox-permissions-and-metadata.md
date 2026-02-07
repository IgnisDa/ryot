# Harden Sandbox Permissions And Metadata

**Parent Plan:** [sandbox-app-api-call](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Implement the permission and metadata hardening described in the parent PRD's `Solution`, `Implementation Decisions`, `Testing Decisions`, and `Out of Scope` sections.

This slice should make sandbox permissions default-none, require valid metadata for sandbox execution, extend the create-script contract so user-created scripts can persist metadata explicitly, make sandbox script metadata non-null in storage, preserve builtin-script allowlists, and update the related sandbox documentation for the stricter permission model.

## Acceptance criteria

- [ ] Sandbox execution treats `allowedHostFunctions` as fully authoritative, with omitted or empty allowlists yielding zero host functions.
- [ ] Invalid metadata and unknown host-function names fail before sandbox code runs.
- [ ] The create-script contract accepts metadata, persists `{}` when omitted, and stores metadata as non-null.
- [ ] Database schema and migration changes enforce non-null sandbox script metadata while preserving builtin-script behavior.
- [ ] Backend unit tests, end-to-end tests, and related sandbox documentation cover the default-none model, metadata validation, builtin-script preservation, and explicit granting of `appApiCall`.

## User stories addressed

- User story 5
- User story 10
- User story 11
- User story 12
- User story 13
- User story 14
- User story 15
- User story 16
- User story 17
- User story 22
- User story 23
- User story 24
