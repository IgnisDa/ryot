# Saved View Query Language Exports

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Create pure backend public exports for saved-view and query-language types, schemas, and expression builders that tests and app-client can import instead of legacy utility packages. This slice should break the old dependency on shared non-Effect query helpers without yet requiring full query execution.

The exported helpers must be side-effect-free and stable enough for tests and app-client to construct query requests.

## Acceptance criteria

- [ ] Public query-language helpers are exported from a pure backend subpath
- [ ] Importing query-language helpers does not initialize backend runtime services
- [ ] Tests can replace legacy view-language imports with the pure backend export
- [ ] App-client can replace legacy query-language imports with the pure backend export later
- [ ] Saved-view/query request schemas use Effect Schema
- [ ] No new backend code imports query-language helpers from `@ryot/ts-utils`

## User stories addressed

Reference by number from the parent PRD:

- User story 18
- User story 19
- User story 47
- User story 63
