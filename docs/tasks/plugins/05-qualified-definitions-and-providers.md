# Qualified Definitions And Providers

**Parent Plan:** [User-Owned Plugins](./README.md)

**Status:** done

## What to build

Make plugin-defined schemas, saved views, signals, and providers safe under private namespaces. Extend the existing process-wide Definition Registry to index kernel, system-plugin, and private-plugin definitions by qualified identity, then implement the provenance decisions in the parent plan's Persistence Model and User-Scoped Registries And Definitions sections across definition-backed domain records. The same local definition or provider slug may exist in unrelated users' plugins, while one user's effective registry remains collision-free.

Persist stable owning plugin identity wherever a local entity, event, relationship, signal, subscription, or saved-view definition slug would otherwise be ambiguous. Runtime and data-validation services must resolve qualified identity rather than selecting a global definition by slug. Plugin manifests may still use local slugs; ingestion resolves references inside the owning user's effective registry.

Private provider execution uses owner user authority and creates user-owned entities. Trusted system providers retain intentional global provider-entity behavior. Existing provider provenance, population, search, details, translation, and relationship flows must continue through sandbox provider operations.

## Acceptance criteria

- [x] The existing Definition Registry supports stable plugin identity plus local slug for system and private definitions, with an explicit kernel-owned representation.
- [x] Persisted definition-backed records contain sufficient qualified plugin provenance to remain unambiguous across users, updates, disablement, and restore.
- [x] Two users can use different definitions and providers with identical local slugs without lookup or database collisions.
- [x] Install rejects collisions inside one user's effective registry, including collisions between a private plugin and installed system definitions.
- [x] Disabled or incompatible plugin definitions remain available for exact historical data decoding but not for new runtime discovery.
- [x] Saved views and signal subscriptions created by a private plugin reference the exact installation or qualified plugin definition required by the parent plan.
- [x] Private provider search, details, resolution, and population execute with owner authority and create user-owned provider entities.
- [x] Global provider entities can be created only from trusted system plugin providers.
- [x] Cross-plugin definition references resolve only through the current user's effective registry and cannot bind to another user's private definitions.
- [x] RyotQL catalog exposure remains user-filtered and does not expose source, compiled code, or plugin config secrets.
- [x] Definition, entity, event, relationship, provider, saved-view, signal, subscription, and query tests cover qualified provenance and cross-user isolation.

## User stories addressed

- User story 27
- User story 30
- User story 38
- User story 39

## Implementor Notes

Use stable plugin identity for definition ownership and installation identity for user activation. Update the Definition Registry module guidance to match its expanded ownership. Do not add a parallel definition registry or encode ownership by concatenating slugs into unvalidated strings.

## Implementation Notes

- The existing definition registry now carries explicit kernel or stable plugin ownership for every schema,
  signal, saved view, provider, and script lookup. User-effective resolution loads private package definitions
  on demand while exact historical lookup remains available independently of runtime availability.
- Entity, event, relationship, signal, notification-subscription, and saved-view persistence now records the
  owning plugin identity where local slugs are ambiguous. The generated migration adds the corresponding
  provenance columns, foreign keys, and qualified uniqueness constraints.
- Private package validation materializes complete qualified definitions against the owner's effective
  registry and rejects user-local collisions or cross-plugin references that are unavailable to that user.
- Provider search, details, resolution, population, related-entity creation, and relationship synchronization
  retain the provider's qualified identity. Private providers execute with owner authority and create
  user-owned data; system providers retain global entity behavior even when a user triggers population.
- Plugin-declared saved views are installation-owned and reconciled transactionally during install and
  package update. Reconciliation preserves user-controlled state, removes obsolete generated views, and
  rejects collisions with non-owned views. Uninstall removes generated views but fences all other qualified
  entity, relationship, signal, subscription, saved-view, and workflow provenance.
- Notification formatting resolves both definitions and scripts through the subscription owner's effective
  registry and exact plugin identity, preventing equal local script slugs from crossing plugin namespaces.
- RyotQL definition catalogs and navigation recipes now expose only definitions available to the current
  user and retain qualified provenance without exposing plugin source, compiled code, or configuration.
