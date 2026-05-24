# Localized Entity Reads

**Parent Plan:** [RyotQL](./README.md)

**Status:** todo

## What to build

Complete the entity read model by allowing catalog fields to resolve either physical or backend-derived SQL values through one uniform interface. Implement localized entity name, localized entity properties, and translation status as backend-owned resolved fields. Migrate application entity-detail and entity-interest reads and their shared recipes to RyotQL.

User execution must propagate the authenticated language through selection, filtering, ordering, JSON paths, includes when they are introduced, and correlated query contexts when they are introduced. Plugin-style canonical execution is tested later, but the resolver interface must accept a language-free context. Translation status must preserve ready, pending, and none behavior and emit its SQL only when referenced. Do not add a public computed-field registry, special selector type, schema metadata, or client-visible translation-table access.

## Acceptance criteria

- [ ] Physical, localized, and derived fields use the same catalog field resolution interface with no table-specific branch in the expression compiler
- [ ] Entity name and properties resolve translated values for language-aware users and canonical values otherwise
- [ ] Translated properties merge over canonical properties without discarding untranslated canonical fields
- [ ] Selection, predicates, ordering, and JSON paths all operate on the same localized field value
- [ ] Translation status is selected as a normal entity field and preserves ready, pending, none, negative-cache, provider, populated, and canonical-language semantics
- [ ] Translation-status SQL is absent when no expression references the field
- [ ] Entity-detail and entity-interest recipes and production consumers use RyotQL directly
- [ ] Focused localization, entity service, recipe, and end-to-end tests cover canonical fallback, partial translation, localized filtering/ordering, and translation status
- [ ] The legacy entity-independent query-engine consumers and tests remain green
- [ ] The RyotQL guide documents localized and backend-derived field behavior

## User stories addressed

- User story 6
- User story 23
- User story 41
- User story 42
- User story 43
