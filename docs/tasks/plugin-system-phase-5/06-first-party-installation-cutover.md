# First-Party Installation Cutover

**Parent Plan:** [Plugin System - Phase 5: Minimal User-Level Plugins](./README.md)

**Status:** todo

## What to build

Move media and fitness onto the same user-owned installation model while retaining their reserved
package identities and trusted package-level authority. This slice applies the parent PRD's
"First-Party Media and Fitness" rules across new-user bootstrap and every existing first-party user
surface.

Create active media and fitness installations for new users. For trusted user bootstrap, keep the
installation removed and invisible until bootstrap succeeds, then activate it. Reconciliation may
create a missing first-party installation only when no active or removed row exists; a tombstone must
survive restart and package reingestion.

Add installation attribution and active-state checks to first-party operations, imports,
integrations, automations, signals, notifications, saved views, user workflows, and direct domain
reads. Migrate first-party user-auth invocation to the installation endpoint, resolve
integration-auth invocation from the persisted integration's installation, and delete the final
production slug-based invoke route. Package boot, package crons, trusted global data, and exact
workflow pinning remain package-level.

Extend removal for first-party installations: refuse while nonterminal work exists, disable owned
integrations, hide package data and catalogs, preserve domain and workspace state, and keep the
tombstone. Reinstall runs trusted idempotent user bootstrap while still removed and activates only on
success.

## Acceptance criteria

- [ ] Media and fitness use reserved code-owned package IDs and normal installation rows for every user
- [ ] New-user bootstrap creates each first-party installation, runs trusted package user bootstrap while it is invisible, and activates it only after success
- [ ] Reconciliation creates a genuinely missing first-party installation but never replaces an active or removed installation row
- [ ] First-party package reingestion preserves package ID, installation state, additive validation, active scripts, and exact workflow pins
- [ ] Definitions, saved views, providers, operations, imports, integrations, automations, signals, notifications, and direct data reads require the affected user's active owning installation
- [ ] First-party user workflow and execution payloads retain installation attribution and recheck active state before package code starts or resumes
- [ ] User-auth first-party operations use the installation invoke endpoint; integration-auth operations resolve installation from the persisted integration
- [ ] The remaining production slug-based invoke route is deleted without a compatibility alias
- [ ] Removing media or fitness refuses nonterminal work, disables owned integrations, hides its workspace and data, and preserves domain, saved-view, cache, integration, and run state
- [ ] First-party reinstall runs idempotent trusted bootstrap while removed and activates only after success without duplicating bootstrap data
- [ ] Package boot and cron dispatch remain once per package schedule with system authority and are not multiplied by installation count
- [ ] Uploaded packages cannot acquire reserved identity or first-party authority through source, manifest, contract input, or mutable database state
- [ ] Existing media, fitness, imports, integrations, automations, notifications, provider, and user-bootstrap assertions remain green
- [ ] Backend check and focused first-party removal/reinstall e2e coverage pass

## User stories addressed

- User story 18
- User story 19
- User story 20
- User story 21
- User story 22
- User story 23
- User story 29
- User story 31
- User story 34
