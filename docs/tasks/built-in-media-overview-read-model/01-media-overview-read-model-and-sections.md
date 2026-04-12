# Media Overview Read Model And Sections

**Parent Plan:** [Built-in Media Overview Read Model](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Deliver the first end-to-end backend slice for the built-in media overview by introducing the dedicated overview read model, exposing the public backend contract, and fully powering the `Continue`, `Up Next`, and `Rate These` sections for `book`, `anime`, and `manga`.

This slice should own section semantics, ordering, response shaping, and presentation defaults while using view-runtime internally for latest-event joins, expression evaluation, and schema-aware data access. The delivered behavior should be sufficient for a caller to render all three sections without reconstructing lifecycle rules in the frontend.

See the parent PRD sections "Solution", "Read-model architecture", "Current-state semantics", "Rate These semantics", "Ordering rules", "Backend contract shape", and "Section-specific payload decisions".

## Acceptance criteria

- [ ] A backend overview endpoint returns the three section payloads `Continue`, `Up Next`, and `Rate These` in one purpose-built response for built-in media only
- [ ] `Continue` and `Up Next` are classified from the latest lifecycle event among `backlog`, `progress`, and `complete`, with `Continue` meaning latest `progress` and `Up Next` meaning latest `backlog`
- [ ] `Rate These` membership is based on latest `complete` being newer than latest `review`, including the no-review case and reread or rewatch re-entry behavior
- [ ] Section ordering matches the PRD rules, including `coalesce(completedOn, complete.@createdAt)` for `Rate These`
- [ ] The response includes both raw structured fields and UI-ready labels, including schema-specific `Continue` CTAs, shared `Start` for `Up Next`, shared subtitle from `publishYear`, and usable progress labels when totals are unknown

## Blocked by

None - can start immediately

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 5
- User story 6
- User story 7
- User story 8
- User story 9
- User story 10
- User story 11
- User story 12
- User story 13
- User story 14
- User story 15
- User story 16
- User story 17
- User story 18
- User story 19
- User story 20
- User story 21
- User story 23
- User story 24
- User story 25
- User story 26
- User story 27
- User story 28
- User story 29
- User story 30
