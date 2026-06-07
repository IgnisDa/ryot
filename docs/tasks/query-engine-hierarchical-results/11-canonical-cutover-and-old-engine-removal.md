# Canonical Cutover And Old Engine Removal

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** todo

## What to build

After the side-by-side v2 engine satisfies the PRD proof criteria, cut consumers over to the v2 query document shape and v2 execution path, delete the old engine and obsolete supporting code/tests, and rename the v2 module, schema, route group, fixtures, and tests to canonical query-engine names. This task should not start until the v2 implementation is independently proven by E2E tests.

Do not keep both query engines long-term. Do not preserve old request-shape compatibility unless a concrete shipped-data requirement is discovered and explicitly handled.

## Acceptance criteria

- [ ] The canonical query-engine execute API uses the v2 query document and response model.
- [ ] Temporary v2 route/module names are renamed to canonical query-engine names.
- [ ] Old query-engine modules, old query-language variants, obsolete view validation paths, obsolete fixtures, and obsolete tests are removed or rewritten.
- [ ] Backend consumers, sandbox host functions, saved-view runtime paths, and frontend query-engine wrappers are updated where they still depend on the old contract.
- [ ] The E2E proof criteria from the parent PRD pass against the canonical query-engine API.
- [ ] No permanent compatibility layer keeps both old and new query engines alive.
- [ ] The old compiler's behavior remains historical context only and does not constrain the canonical v2 implementation.

## User stories addressed

Reference by number from the parent PRD:

- User story 28
- User story 29
- User story 30
- User story 34
