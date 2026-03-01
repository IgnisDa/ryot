# Installation-Scoped Operations

**Parent Plan:** [Plugin System - Phase 5: Minimal User-Level Plugins](./README.md)

**Status:** todo

## What to build

Extend synchronous user installation with the operation slice from the parent PRD's "Uploaded
Manifest Subset", "Registry, Visibility, and Dispatch", and "Public Contracts" sections. A user can
install an operation script, invoke it through installation identity, and use only the fixed
package-scoped host surface.

Carry trusted installation identity through operation resolution, sandbox authority, host-function
selection, execution attribution, cache partitioning, and package-owned data writes. Restrict query
documents and definition-listing calls to the executing package's physical definitions and the
installation's rows, even when the same user has another active package. Restrict writes to
package-owned definitions and inject user plus installation ownership in the backend.

Expand uploaded manifest validation only for user-auth operations and operation scripts. Reject
integration auth, generic, workflow, and automation scripts and every capability outside the exact
minimal list in the PRD. Add the installation-based invoke endpoint. Keep the old invoke route
temporarily restricted to trusted first-party packages until Task 06 migrates them to installation
identity.

## Acceptance criteria

- [ ] Uploaded installation accepts user-auth operation declarations and matching operation scripts while retaining all definition-only validation from Task 02
- [ ] `POST /plugin-installations/:installationId/operations/:operationSlug` resolves only an active installation owned by the authenticated user
- [ ] Sandbox execution authority and persisted execution attribution carry trusted installation and package identity that scripts cannot substitute
- [ ] Uploaded `executeQueryEngine`, definition-listing, entity ensure, relationship change, and event creation calls are restricted to package-owned physical definitions and installation-owned rows
- [ ] Uploaded writes persist installation attribution and cannot target another package's definitions or another user's rows
- [ ] Ephemeral and persistent cache keys include installation identity while preserving provider-or-script partition behavior
- [ ] The allowed capability list is exhaustive; networking, config, integration access, global writes, signals, notifications, filesystem grants, and unknown capabilities fail installation
- [ ] Integration-auth operations and generic, workflow, or automation script kinds fail uploaded installation
- [ ] An active user operation becomes unavailable immediately when its installation is not active
- [ ] The temporary old invoke route rejects uploaded packages and remains available only for trusted first-party behavior scheduled for Task 06 migration
- [ ] Two users installing the same operation source receive independent execution, data, and cache behavior
- [ ] One user with two active packages cannot use an operation from one package to query, mutate, or list definitions from the other
- [ ] Backend check, operation/capability/host tests, and operation isolation e2e coverage pass

## User stories addressed

- User story 5
- User story 6
- User story 7
- User story 16
- User story 17
- User story 26
- User story 29
- User story 32
