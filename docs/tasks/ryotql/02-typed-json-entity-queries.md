# Typed JSON Entity Queries

**Parent Plan:** [RyotQL](./README.md)

**Status:** todo

## What to build

Extend the working entity rows path with the generic expression behavior needed to query entity JSON without property-schema involvement. Add deep JSON paths, explicit safe casts, literals, comparisons, boolean combinators, null checks, containment, coalesce where required by rows, and ordering over resolved expressions. Demonstrate the complete SDK-to-endpoint-to-PostgreSQL behavior through realistic book, movie, and course queries.

The query validator must verify AST shape, alias scope, public field access, JSON-path eligibility, and cast targets without loading property definitions or resolving discriminator values. Runtime casts must return null for missing paths, JSON null, incompatible values, malformed dates, and unsupported numeric values. Preserve null-as-false comparisons, structural JSON equality, escaped case-insensitive text containment, array/object containment, deterministic C collation, empty boolean identities, and ordinary SQL behavior for unknown discriminator values.

## Acceptance criteria

- [ ] SDK builders exist for deep JSON paths, safe casts, literals, comparisons, boolean logic, null checks, containment, coalesce, and expression ordering
- [ ] Contract decoding and semantic validation reject malformed expressions, unknown aliases, unknown fields, and JSON paths against non-JSON fields
- [ ] RyotQL performs no query-time property-schema loading, path validation, type inference, schema metadata resolution, or schema-list validation
- [ ] Safe text, number, boolean, date, and JSON casts produce null instead of aborting on missing, null, incompatible, malformed, or out-of-range values
- [ ] Equality, ordering comparisons, null behavior, negation, containment escaping, structural JSON behavior, C collation, and empty combinators match the parent PRD
- [ ] Schema discriminator filters are ordinary equality or membership predicates, and unknown values return empty rows rather than definition errors
- [ ] End-to-end tests query single- and multi-discriminator books, movies, and courses with nested JSON values and scalar ordering
- [ ] Existing collections behavior and the complete legacy query-engine suite remain green
- [ ] The RyotQL guide documents the new expression and JSON semantics

## User stories addressed

- User story 5
- User story 6
- User story 7
- User story 20
- User story 21
- User story 22
- User story 23
