# Definition-Only User Installation

**Parent Plan:** [Plugin System - Phase 5: Minimal User-Level Plugins](./README.md)

**Status:** todo

## What to build

Deliver the first complete ordinary-user installation path using the parent PRD's "Installation
Storage", "Synchronous Ingestion", "Simple Limits", and "Public Contracts" decisions. This first
slice accepts uploaded packages containing entity definitions, nested event definitions,
relationship definitions, and saved views only; Tasks 03 and 04 extend the same path with executable
operations and providers.

Add the user-owned installation record and one-installation-per-user/package constraint. Accept the
existing manifest plus source-file-map request on the authenticated installation endpoint, validate
the definition-only uploaded subset and simple limits, compile synchronously through the existing
ingestion path, and serialize package plus active-installation persistence with registry replacement.
A failure leaves no package or installation active.

Serve installation list/detail and installation-filtered definition and saved-view catalogs for the
current user. Keep one global namespaced package snapshot; visibility comes from installation state,
not per-user snapshots. Delete the production administrator plugin list/install/uninstall contract.
Retain the current invoke route only for trusted first-party behavior until Task 06 creates
first-party installation rows, then delete it there. Existing e2e package setup that still needs
broader trusted manifests uses gated test support until later slices expose the final uploaded
subset.

## Acceptance criteria

- [ ] Installation persistence links an opaque installation ID, user ID, package ID, active state, workspace order, and timestamps with one row per user/package
- [ ] Authenticated users can synchronously install a valid definition-only package through `POST /plugin-installations` and receive HTTP 201 with their active installation
- [ ] `GET /plugin-installations` and `GET /plugin-installations/:installationId` return only installations owned by the current user
- [ ] Uploaded definition and saved-view references are normalized to the package's physical identities before persistence or registry loading
- [ ] Definitions and saved views appear for the installing user and remain absent from another user's catalogs and direct reads
- [ ] Uploaded manifests with scripts, providers, operations, bootstrap, config fields, signals, workflows, imports, integrations, automations, crons, boot entries, networking, filesystem grants, or global authority are rejected in this slice
- [ ] Source-map byte, file-count, per-file, path-length, manifest-cardinality, package-count, and one-in-flight-install limits fail before persistence without partial state
- [ ] Validation, compilation, persistence, and registry-rebuild failures leave no active package or installation and return structured boundary errors
- [ ] The production administrator global list, install, and uninstall endpoints and middleware are deleted; gated test installation remains available
- [ ] The current invoke route is restricted to trusted first-party behavior and explicitly scheduled for deletion in Task 06 rather than broken in this slice
- [ ] Two users can upload definition packages with identical local slugs and receive isolated physical definitions
- [ ] Backend check, focused installation/definition tests, and the definition-only two-user e2e path pass

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 12
- User story 15
- User story 16
- User story 26
- User story 27
- User story 28
- User story 31
