# Registry Trust and Provenance Simplification

**Parent Plan:** [Plugin System - Phase 4](./README.md)

**Status:** done

## What to build

Make current trusted-registry semantics explicit and remove inert provenance scaffolding. Read the
overview, Phase 4 plan, parent PRD, and this task first.

All Phase 4 registry definitions are immutable system-provided definitions. Kernel source zero versus
plugin ownership is represented by source attribution, not by never-populated non-builtin sets.
Simplify entity, relationship, event, signal, and saved-view conversion/authorization consistently.
Preserve existing first-party API behavior where consumers still use builtin to mean trusted
registry-provided; do not speculate about Phase 5 user-package trust.

## Acceptance criteria

- [x] Non-builtin provenance types, empty sets, replacement parameters, and predicates with no real producer are removed
- [x] Plugin ownership remains available through explicit package/source attribution
- [x] Entity, relationship, event, signal, and saved-view responses use one documented trusted-definition meaning
- [x] Signal schema and audience authorization no longer depends on an unexplained hardcoded builtin value
- [x] First-party media/fitness behavior and existing API assertions remain compatible
- [x] User-authored package trust fields, installation state, or capability consent are not introduced
- [x] Unit and e2e tests cover kernel source-zero and plugin-owned trusted definitions
- [x] Documentation names the Phase 4 meaning and points future user trust to Phase 5

## User stories addressed

- User story 50
