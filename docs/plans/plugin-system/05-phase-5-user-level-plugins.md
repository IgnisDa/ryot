# Phase 5 - User-level plugin installation

Status: planned, design incomplete. Do not implement this phase until Phase 4 is complete and the
open questions below have been resolved with the owner.

Goal: let ordinary Ryot users upload and install sandboxed plugin packages for themselves. Plugin
code and immutable package definitions may be shared internally, but installation state, authority,
configuration, credentials, bootstrap state, visibility, jobs, caches, and uninstall behavior belong
to one user. Media and fitness remain shared first-party packages and are auto-installed for every
user; users may remove those installations while preserving their data.

This phase replaces the earlier idea of an administrator-managed public plugin surface. Ryot has no
ordinary administrator role for plugin approval; god mode is unrelated. Users are the installers and
approvers of their own plugins. Sandbox isolation is necessary but not sufficient: host capabilities,
network access, compiler/runtime resources, scheduler authority, global data, and cross-user dispatch
all cross the sandbox boundary and require explicit design.

## Settled direction

1. Phase 5 is separate from Phase 4. Phase 4 must not build speculative per-user installation or
   capability-consent infrastructure.
2. Plugin versioning and in-place upgrades are not part of the first user-level milestone. The exact
   replacement behavior remains an open question below.
3. Every ordinary user can submit plugin source. There is no administrator approval workflow.
4. Media and fitness are shared first-party packages and are auto-installed for each user.
5. Users may remove media or fitness installations. Removal stops visibility, bindings, jobs, and
   notifications but preserves user data. Reinstall restores access idempotently.
6. A package-level media-monitoring sweep may continue to query across users, but it must process
   only active media installations. Running the same cross-user sweep once per user installation is
   forbidden.
7. User-level plugin code remains sandboxed. System-only capabilities are not grantable merely
   because a manifest requests them.
8. New capabilities require e2e coverage, including isolation between two users installing the same
   source.

## Recommended package and installation split

The preferred starting model, still subject to the open identity questions, has two layers:

- A package/artifact owns immutable source, compiled scripts, a validated manifest, definitions,
  provider declarations, and content hashes. Identical bytes may be deduplicated internally.
- A user installation owns an opaque installation identity, user id, approved capabilities, config,
  credentials, enabled state, bootstrap completion, execution provenance, cache namespace, bindings,
  scheduled user work, and uninstall state.

Two users installing the same package have independent installations even if immutable package bytes
are shared. Treating them as duplicate copies of every compiled script and definition is not the
recommended implementation: it wastes compilation/storage and makes shared global entities and
schema identity ambiguous.

## Required architectural consequences

These are consequences of the goal, not yet approved implementation details:

- The current flat global slug registry cannot safely load unrelated user packages that claim the
  same schema, provider, script, import-source, integration-provider, or signal slug. Phase 5 needs
  system-assigned physical namespacing or another scoped-identity model.
- User-facing catalogs, saved views, schema visibility, operations, imports, integrations,
  automations, signals, and notifications must be filtered by active installation.
- Package-level trusted execution and installation-level user execution are different authorities.
  Cross-user media monitoring, global provider refresh, and first-party catalog preload are
  package-level. User bootstrap, imports, operations, integrations, and user automations are
  installation-level.
- Manifest bindings cannot become active for every user merely because package code exists. The
  affected user must have an active installation.
- Shared media/provider entities may remain package-level global data. User relationships, events,
  config, credentials, and preferences remain user-owned.
- Removing an installation while preserving data means package definitions cannot be garbage
  collected while that data or a workflow pin still references them.
- A user's inactive media installation must be excluded from media-monitoring relationships, signal
  audiences, automation dispatch, notifications, and package-level system queries.
- Uploaded source compilation, storage, execution, networking, durable workflows, logs, and caches
  need per-user quotas and abuse controls.

## Security floor

Arbitrary source cannot inherit the current trusted-plugin assumptions. At minimum, the design must
address:

- Private, loopback, link-local, metadata-service, and DNS-rebinding protection for outbound HTTP.
- Rate and quota limits for installs, source bytes, compile time, compiler concurrency, executions,
  durable steps, host calls, storage, caches, logs, and scheduled work.
- Package-owned schema and provider enforcement for every write capability.
- Installation-owned config, secrets, integration credentials, and cache namespaces.
- Prevention of cross-user reads, writes, bindings, signals, notifications, and workflow dispatch.
- A hard distinction between first-party system packages and ordinary uploaded packages. Ordinary
  packages must not receive package-level boot, system cron, global-write, system-config, kernel
  workflow, or cross-user query authority.
- User-visible capability review or a fixed safe capability profile. This choice is still open.
- Failure containment and cleanup for compiler crashes, runtime timeouts, workflow suspension,
  uninstall, and backend restart.

## Open questions

Resolve every item before writing the Phase 5 PRD.

### Identity and storage

1. What is the stable package identity: source hash, generated package id, publisher/name pair, or a
   combination?
2. Are identical uploads deduplicated into one package artifact, and can users inspect that sharing?
3. Does "no versioning" mean a package is immutable and replacement is uninstall plus a new package,
   or may source be replaced in place when no data exists?
4. How are logical manifest slugs translated into globally safe physical definition and provider
   identities?
5. May one user install two independent instances of the same package?
6. Which records reference package identity, installation identity, or both?
7. How are first-party package identities kept stable across ordinary Ryot development changes when
   public versioning is absent?

### Installation lifecycle

8. Is package ingestion and installation one synchronous request, or may compilation/install become
   durable and resumable?
9. What state machine covers compiling, validating, awaiting capability approval, bootstrapping,
   active, disabled, failed, and removing?
10. When does `userBootstrap` run, how is completion keyed, and how is it retried after interruption?
11. Does reinstalling a removed package expose preserved data before or after bootstrap reconciliation?
12. What happens when the last installation is removed but preserved data still references package
    definitions?
13. Can users disable an installation separately from removing it, and what behavior remains visible
    while disabled?

### Capability and trust model

14. Does the user review and approve requested capabilities, or does every uploaded package receive a
    fixed safe profile?
15. Which read capabilities are package-scoped versus allowed to inspect all of the installing user's
    data?
16. May an ordinary package declare user-scoped crons, workflows, automations, signals, integration
    providers, import sources, or filesystem grants in the first milestone?
17. How are capabilities changed after installation when package replacement/versioning is absent?
18. How is first-party system-package provenance established without an administrator approval model?
19. Which capability combinations require additional warnings or cannot be granted at all?

### Scheduling and cross-user behavior

20. Which manifest sections are package-level and which are installation-level?
21. How are per-installation crons bounded so user count cannot multiply work without limit?
22. How does a package-level media-monitoring query join active installation state without leaking
    data between users?
23. What happens to queued user work when an installation is disabled or removed?
24. How are workflow pins attributed to an installation, and when do they block removal?

### Definitions, global data, and queries

25. Are ordinary user packages allowed to define globally populated entities and providers, or only
    user-owned data in the first milestone?
26. Can two different packages define structurally different logical schemas with the same slug?
27. How does query validation distinguish package-owned definitions while retaining ergonomic plugin
    authoring slugs?
28. Which preserved rows remain readable after installation removal, and through which generic APIs?
29. How do automation and signal audience rules prove that each affected user has the owning package
    installed and active?
30. How are saved-view ordering and disabled state restored across remove/reinstall?

### Distribution and product surface

31. How does a user submit a source bundle, inspect diagnostics, and identify a previously uploaded
    package?
32. Is there any package sharing/discovery UI in the first milestone, or only direct source upload?
33. How are requested capabilities, network access, config fields, data ownership, and removal effects
    explained before installation?
34. Are signing, publisher identity, attestation, inter-plugin dependencies, and a marketplace still
    deferred, and which provenance fields must be retained now to enable them later?

### Verification

35. What e2e matrix proves two-user isolation for installs, config, cache, events, relationships,
    imports, integrations, automations, notifications, workflows, disable, removal, and reinstall?
36. Which abuse tests cover install flooding, compilation limits, SSRF, scheduled work, oversized
    manifests, and durable workflow exhaustion?
37. Which package-level first-party tests prove that cross-user media monitoring includes active
    installations and excludes inactive ones without duplicate sweeps?

## Phase 4 handoff requirements

Phase 4 should leave clean global package primitives that Phase 5 can reuse: immutable
content-addressed scripts, exact workflow pins, race-safe uninstall/reference checks, script-row GC,
manifest-driven capabilities, a pure kernel boundary, and clear package ownership through
`pluginSlug`. It must not create compatibility APIs, user-installation tables, user namespaces, or
speculative trust UX on Phase 5's behalf.

## Explicit non-goals until questions are resolved

- Implementation tasks or schema migrations for user-level installation.
- Plugin version coexistence or in-place upgrade.
- Marketplace, package search, publisher accounts, signing, or attestation.
- Inter-plugin dependency resolution.
- Automatic plugin data deletion on removal.
- A second standalone user-script authoring mechanism.
