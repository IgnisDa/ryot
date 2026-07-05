# Definition Registry

This module owns the in-memory, slug-keyed snapshot of schema, tracker, and builtin saved-view
definitions. Reads are synchronous. A replacement source is fully validated and frozen before the
single snapshot reference is swapped, so readers see either the previous complete snapshot or the
next complete snapshot.

The registry is fed directly from `modules/builtins/` during Phase 1. It contains definitions only;
user state and persisted domain data do not belong here.
