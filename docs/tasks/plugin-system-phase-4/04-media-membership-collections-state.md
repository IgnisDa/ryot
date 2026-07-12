# Media Membership for Collections and User State

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** todo

## What to build

Complete media library extraction for collection membership and user-state policy, then remove the
native library-specific module and contract. Read the overview, Phase 4 plan, parent PRD, and this
task first; tasks 02 and 03 are prerequisites.

Generic collection membership continues to own `member-of`. Media-owned lifecycle/relationship
handling adds `in-library` for eligible media entities and is awaited wherever the successful
collection operation currently guarantees the final relationship state. Express the prohibition on
clearing or merging library user state as generic entity-schema policy declared by media and enforced
without a library slug branch.

Remove obsolete library-specific routes, service/workflow wrappers, queue names, contract grouping,
repository queries, layer wiring, and kernel workflow references. Retain a generic entity-import API
and generic collection behavior; do not introduce compatibility aliases for old library names.

## Acceptance criteria

- [ ] Collection writes remain generic and own only collection plus `member-of` behavior
- [ ] Adding an eligible global media entity to a collection yields the same awaited `in-library` outcome
- [ ] Fitness and unrelated fixture entities are excluded from automatic media membership
- [ ] Entity-schema policy generically enforces clear/merge restrictions declared for the media library
- [ ] User-state production code contains no `library` string branch or media-specific error constant
- [ ] The native library-specific module, routes, contract group, workflows, repositories, queues, and layer wiring are removed
- [ ] The generic entity-import endpoint has domain-neutral naming and no deprecated alias
- [ ] Existing collection and user-state behavior tests retain their assertions, with explicit non-media coverage added
- [ ] No cross-sandbox transaction is introduced to preserve the old internal transaction boundary
- [ ] All related temporary purity entries are removed

## User stories addressed

- User story 5
- User story 7
- User story 8
- User story 9
