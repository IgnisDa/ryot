# Sandbox Execution And Media Monitoring

**Parent Plan:** [RyotQL](./README.md)

**Status:** todo

## What to build

Add the separate `executeRyotql` sandbox host capability, `@ryot/sandbox-sdk/ryotql` entry point, generic sandbox read recipes, strict response helpers, and plugin execution scope. Migrate media-monitoring status, enablement support reads, and scheduled sweep queries to RyotQL without implicit cross-user endpoint entity access.

Pinned plugin metadata determines plugin authority. Documents never carry a scope. Plugin entity visibility is limited to global rows with owned discriminators; plugin event and relationship visibility may cross users only for owned definitions. The monitoring status query reads the current user's visible relationship targetEntityId as the library identifier. The system sweep checks existence of any owned media-monitoring relationship across users while reading only global media entities. Keep the legacy executeQueryEngine capability for unmigrated scripts.

## Acceptance criteria

- [ ] The sandbox SDK re-exports the shared RyotQL builders and sandbox recipes rather than implementing another builder language
- [ ] Strict sandbox response helpers accept only the RyotQL named data envelope and dynamic field-value shape
- [ ] The new host capability is independently capability-gated and derives user or pinned-plugin authority from trusted execution context
- [ ] Sandbox callers cannot supply a user ID, plugin slug, execution scope, or grant in a document or host call
- [ ] Plugin entity visibility is global and restricted to plugin-owned discriminator definitions
- [ ] Plugin event and relationship visibility spans users only for plugin-owned definitions, while application tables remain denied
- [ ] Visibility is applied to every sandbox query table occurrence, join, include, and correlated query before caller predicates
- [ ] User monitoring status sees only the current user's monitoring relationship and obtains the library identifier from targetEntityId
- [ ] The scheduled sweep finds global provider-backed media monitored by any user without selecting user-owned library endpoint fields
- [ ] Media-monitoring multi-user, cron, notification, unsupported-target, sandbox authority, and host capability tests pass
- [ ] The legacy executeQueryEngine capability and all unmigrated scripts remain operational
- [ ] The RyotQL guide documents user and plugin execution semantics

## User stories addressed

- User story 30
- User story 31
- User story 32
- User story 33
- User story 34
- User story 35
- User story 36
- User story 37
- User story 38
- User story 39
- User story 40
- User story 43
