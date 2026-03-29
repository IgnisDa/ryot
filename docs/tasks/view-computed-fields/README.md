# View Computed Fields

## Problem Statement

Users can currently build saved views and raw view-runtime requests only around direct field references and simple fallback arrays. That is not expressive enough for the derived data real view UIs need. Users cannot define reusable computed values like a display label composed from multiple fields, a fallback across entity and latest-event data, a calculated score, or conditional badges driven by joined event state. Because these derived values are not part of the view definition itself, they also cannot be reused consistently across display output, sorting, and filtering.

The current reference-only model also makes the backend harder to evolve. Display output, filtering, and sorting each interpret field references separately, which creates duplication and limits future join kinds or richer expression support. Ryot needs a single schema-aware, type-safe view language that treats computed fields as first-class parts of a saved view and a raw runtime request.

## Solution

Introduce a unified expression and predicate language for saved views and raw view-runtime execution. Both request types will support `computedFields` as named reusable expressions. Expressions can read entity fields, latest joined event fields, constants, and other computed fields. Expressions will support arithmetic, numeric normalization, string composition, fallback/coalescing, and conditional branching. Predicates will operate on expressions instead of only raw fields.

View-runtime execution will validate references and types against the participating entity schemas and event joins, detect computed-field dependency cycles, compile computed fields once into the query plan, and allow computed fields to be used anywhere a direct field is useful: output fields, saved-view display configuration, sort expressions, and filter predicates. This intentionally reshapes the saved-view and runtime contracts into a cleaner long-term model without backward-compatibility shims.

## User Stories

1. As a user, I want to define a computed field inside a saved view, so that the view itself owns the derived value it depends on.

2. As a user, I want to define a computed field in a raw view-runtime request, so that I can experiment with derived data without creating a saved view first.

3. As a user, I want a computed field to read entity built-in fields, so that I can derive values from names and timestamps, and use images only in display-oriented expressions.

4. As a user, I want a computed field to read entity schema properties, so that I can derive values from tracker-specific data.

5. As a user, I want a computed field to read latest joined event fields, so that I can build views driven by the newest review, purchase, or other event.

6. As a user, I want a computed field to reference another computed field, so that I can break complex logic into smaller reusable pieces.

7. As a user, I want computed fields to support constant values, so that I can inject labels, defaults, and fixed values into a view.

8. As a user, I want computed fields to support fallback logic, so that a value can come from one source when present and another when missing.

9. As a user, I want computed fields to support arithmetic, so that I can calculate scores, deltas, and simple derived numbers.

10. As a user, I want computed fields to support numeric normalization operations such as rounding, flooring, and integer conversion, so that derived numeric values can be presented and reused in a UI-friendly form.

11. As a user, I want computed fields to support string composition, so that I can build labels and display text from multiple sources.

12. As a user, I want computed fields to support conditional logic, so that badges and display values can change based on data.

13. As a user, I want computed fields to work in grid output, so that card views can show derived titles, subtitles, badges, and images.

14. As a user, I want computed fields to work in list output, so that compact views can render the same derived values consistently.

15. As a user, I want computed fields to work in table output, so that tabular views can include calculated columns.

16. As a user, I want computed fields to be returned as named raw runtime output fields, so that runtime consumers can request derived values directly even when they are not using grid, list, or table display slots.

17. As a user, I want to sort by a computed field, so that derived rankings and labels can control ordering.

18. As a user, I want to filter by a computed field, so that derived business logic can define which entities appear.

19. As a user, I want filters to operate on arbitrary expressions instead of only raw field references, so that I can query on derived values directly.

20. As a user, I want conditional expressions to treat missing joined events as null, so that I can safely branch on event data.

21. As a user, I want fallback expressions to work across multiple entity schemas, so that one view can unify different schema shapes.

22. As a user, I want latest-event joins to continue working with missing schemas or missing rows as null-valued sources, so that mixed-schema views remain predictable.

23. As a user, I want computed values to resolve consistently everywhere in the response, so that I do not see one value in display output and a different value in sorting or filtering behavior.

24. As a developer, I want saved views and raw runtime requests to share the same expression language, so that there is one mental model and one validation path.

25. As a developer, I want direct field references to become structured reference nodes, so that future join kinds and new source types can be added without inventing more string syntax.

26. As a developer, I want expression validation to be schema-aware, so that invalid properties and invalid joins fail fast.

27. As a developer, I want expression validation to infer result types, so that unsupported operations are rejected before execution.

28. As a developer, I want sort validation to enforce sortable scalar result types, so that runtime ordering stays predictable.

29. As a developer, I want filter validation to enforce operator compatibility with the inferred expression type, so that invalid predicates are rejected clearly.

30. As a developer, I want image fields to remain display-only, so that the query language preserves existing backend semantics around image handling and clearly rejects image expressions in sorting, filtering, arithmetic, or other non-display operations.

31. As a developer, I want computed-field dependency cycles to be rejected, so that the runtime cannot enter recursive or ambiguous evaluation states.

32. As a developer, I want computed fields to be evaluated in dependency order, so that nested computed expressions compile and run deterministically.

33. As a developer, I want computed fields to be compiled once per query plan, so that display, filtering, and sorting can reuse the same SQL projection.

34. As a developer, I want expression compilation to be centralized, so that the backend does not maintain separate logic for display output, sort clauses, and filters.

35. As a developer, I want predicates to be represented as an AST, so that top-level filtering and conditional branching can share the same boolean language.

36. As a developer, I want the new model to be explicitly breaking, so that the backend can adopt the cleanest long-term contract instead of carrying translation layers.

37. As a developer, I want built-in saved-view defaults and bootstrap data to use the new expression model, so that system-defined views follow the same contract as user-defined views.

38. As a developer, I want saved-view persistence to continue using JSONB, so that the backend can store flexible query definitions without introducing many relational tables.

39. As a developer, I want request and response schemas to stay strongly typed in the OpenAPI contract, so that test fixtures and clients can evolve safely.

40. As a developer, I want tests to cover both isolated validation behavior and end-to-end runtime execution, so that the feature is reliable at the language and execution layers.

41. As a developer, I want error messages to identify the invalid expression, reference, or dependency clearly, so that direct payload authoring remains practical without a frontend builder.

42. As a product developer, I want this design to leave room for future expression kinds and future join kinds, so that later expansion does not require another contract reset.

## Implementation Decisions

- Replace the current string-reference-plus-fallback-array model with a unified expression AST used by both saved views and raw view-runtime requests.
- Add `computedFields` as named reusable expressions at the query-definition level for both saved views and runtime requests.
- Allow computed fields to reference entity built-ins, entity properties, latest-event built-ins, latest-event properties, and other computed fields.
- Add structured reference variants for entity columns, entity properties, event-join columns, event-join properties, and computed fields.
- Replace the current flat filter objects with a predicate AST that operates on expressions and supports top-level filtering plus conditional-expression branching.
- Support the first expression set required for rich derived UI data: literal values, references, coalesce/fallback, arithmetic operations, numeric normalization operations such as rounding, flooring, and integer conversion, string composition, and conditional branching.
- Support the first predicate set required by current and planned runtime behavior: equality and inequality comparisons, range comparisons, null checks, and composition needed by conditional branches and top-level filtering.
- Keep latest-event joins as the only supported join kind in this phase, but design expression references so new join kinds can be added without changing the surrounding expression language.
- Continue treating missing latest-event rows and unavailable join values as `null`, so that fallback and conditional logic compose naturally with existing runtime semantics.
- Preserve the rule that image sources are display-only and may appear only in display-oriented output expressions; image-valued expressions must be rejected from sorting, filtering, arithmetic, string composition, and any other non-display operation.
- Require unique computed-field keys within a view definition or runtime request.
- Reject computed-field dependency cycles during validation and include the dependency path in the validation error.
- Topologically order computed fields before SQL compilation so computed fields can safely reference other computed fields.
- Infer expression result types during validation and use those inferred types to validate sorting, filtering, display compatibility, and branch compatibility.
- Define clear type-unification rules for conditional and coalescing expressions so mixed branches either resolve to a supported common type or fail validation.
- Compile computed fields into a shared projected query stage so sorting, filtering, and display reuse the same SQL expressions instead of recompiling them independently.
- Refactor view-runtime execution around a deeper expression compiler module that encapsulates SQL generation, type handling, and null semantics behind a stable interface.
- Refactor validation around a deeper expression analysis module that resolves references, validates schemas and joins, infers result types, and reports cycles and unsupported operations.
- Reshape saved-view display configuration so grid, list, and table slots/columns store expressions directly instead of ordered string fallback arrays.
- Reshape runtime output field definitions so each field has a single expression instead of a `references` array, with fallback expressed explicitly via `coalesce`.
- Explicitly support computed fields as named raw runtime output fields in the response `fields` array, independent of any saved-view display layout or display slot configuration.
- Keep saved-view persistence in JSONB columns, but replace the JSON structure stored in those columns with the new expression-based definitions.
- Do not preserve backward compatibility for existing saved-view or view-runtime payloads; update the contract cleanly and migrate built-in data to match.
- Do not add authoring support to the saved-view frontend builder UI; direct payloads and config remain the supported authoring path for this feature.
- Update runtime documentation to describe the new expression and predicate language with concrete examples for saved views and direct runtime execution.

## Testing Decisions

- Good tests should verify external behavior: accepted and rejected payloads, runtime results, sort order, filter semantics, null propagation, and persisted saved-view behavior. They should avoid coupling to internal SQL string shape unless a low-level compiler module has an intentionally stable contract.
- Add isolated tests for the expression analysis module to cover reference resolution, inferred types, operator compatibility, branch compatibility, and computed-field cycle detection.
- Add isolated tests for the expression compiler module to cover null semantics, computed-field dependency ordering, and reuse of computed projections across display, sort, and filter compilation.
- Add backend validation tests around saved-view creation and update to ensure the new contract is enforced consistently for persisted views.
- Add backend runtime tests around raw `/view-runtime/execute` requests to verify computed fields in output, sorting, and filtering.
- Add end-to-end tests that exercise entity fields, latest-event fields, nested computed fields, fallback logic, arithmetic, numeric normalization, string composition, constants, and conditional logic.
- Add end-to-end tests for negative cases including invalid references, invalid type/operator combinations, unsortable expressions, unsupported non-display image usage, and computed-field cycles.
- Use the existing saved-view and view-runtime test suites as prior art for request validation, persistence coverage, runtime behavior, and mixed-schema/latest-event scenarios.

## Out of Scope

- Frontend saved-view builder support for authoring computed fields.
- Additional join kinds beyond latest-event joins.
- Aggregations, rollups, or cross-entity computations.
- Advanced formatting functions such as date formatting, localization, or templating helpers.
- Non-essential expression kinds that are not needed for arithmetic, composition, fallback, constants, or conditionals.
- Backward-compatibility layers for legacy saved-view or runtime payloads.

## Further Notes

- This feature should be delivered as a foundation for future view-language growth, not as a small patch on top of the current reference-array model.
- The design should favor deep reusable modules for expression analysis and expression compilation so later features can extend the language without duplicating validation or SQL-generation logic.
- The OpenAPI contract, fixtures, bootstrap defaults, and runtime documentation should all move together so direct payload authoring remains ergonomic despite the lack of frontend UI support.
- Backward compatibility is explicitly not required for saved-view payloads, runtime payloads, persisted saved-view JSON, or the frontend editing experience in this plan.

---

## Tasks

**Overall Progress:** 5 of 6 tasks completed

**Current Task:** [Task 06](./06-validation-hardening-docs-and-tests.md) (todo)

### Task List

| #   | Task                                                                                 | Type | Status | Blocked By       |
| --- | ------------------------------------------------------------------------------------ | ---- | ------ | ---------------- |
| 01  | [Expression Contract Foundation](./01-expression-contract-foundation.md)             | AFK  | done   | None             |
| 02  | [Computed Fields And Raw Output](./02-computed-fields-and-raw-output.md)             | AFK  | done   | Task 01          |
| 03  | [Expression Filtering And Sorting](./03-expression-filtering-and-sorting.md)         | AFK  | done   | Task 02          |
| 04  | [Rich Derived Expression Support](./04-rich-derived-expression-support.md)           | AFK  | done   | Task 03          |
| 05  | [Frontend Read-Only View Management](./05-frontend-read-only-view-management.md)     | AFK  | done   | Task 02          |
| 06  | [Validation Hardening, Docs, And Tests](./06-validation-hardening-docs-and-tests.md) | AFK  | todo   | Task 04, Task 05 |
