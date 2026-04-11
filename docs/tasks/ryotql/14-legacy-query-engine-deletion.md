# Legacy Query Engine Deletion

**Parent Plan:** [RyotQL](./README.md)

**Status:** todo

## What to build

Prove that every production consumer has migrated, then remove the complete legacy query-engine system in one atomic task. Delete its contract group, authenticated endpoint, backend service, language, validators, schema loaders, compilers, executors, localization helpers, response helpers, application SDK package or exports, recipes, sandbox capability and helpers, tests, fixtures that exist only for the old language, and authoritative guide. RyotQL keeps its existing name and public surfaces. This also includes the docs that describe the legacy query engine, its language, and its SDK. The RyotQL guide is the only authoritative query-language guide after deletion.

Do not begin deletion until repository-wide searches confirm that no production import, contract call, sandbox host call, saved-view document, recipe, application consumer, plugin consumer, or test outside the legacy suite still depends on query-engine. Remove obsolete dependency edges and update remaining generic documentation, package metadata, monorepo configuration, and test fixtures to refer only to RyotQL.

## Acceptance criteria

- [ ] Repository-wide searches confirm no production consumer, persisted document builder, sandbox script, contract client, or shared recipe references legacy query-engine APIs
- [ ] The legacy HTTP contract group and endpoint are deleted
- [ ] The complete legacy backend query-engine module and its source-specific implementation are deleted
- [ ] Legacy SDK primitives, document builders, recipes, response compatibility helpers, package exports, and sandbox executeQueryEngine capability are deleted
- [ ] Legacy-only tests, fixtures, documentation, package dependencies, and monorepo configuration are deleted or migrated
- [ ] No compatibility alias, translator, format detector, deprecated export, or rename from RyotQL is introduced
- [ ] All RyotQL SDK, contract, backend, client, recipes, plugin, sandbox, and end-to-end tests pass after deletion
- [ ] Backend, frontend, contract, sandbox SDK, plugin, and monorepo checks pass through the required Turbo commands
- [ ] The RyotQL guide is the only authoritative query-language guide

## User stories addressed

- User story 46
- User story 47
- User story 48
- User story 49
- User story 50
- User story 51
