# Overview Hardening And Mixed-Media Coverage

**Parent Plan:** [Built-in Media Overview Read Model](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Harden the built-in media overview implementation with representative mixed-media coverage, lifecycle-transition coverage, and predictable failure behavior so the first backend-powered slice is trustworthy under realistic event histories.

This slice should strengthen confidence in the overview contract rather than expand product scope. It should focus on mixed `book`, `anime`, and `manga` behavior, reread and rewatch state transitions, unsupported-schema enforcement, and backend behavior when built-in configuration is missing or malformed.

See the parent PRD sections "Validation and access", "Testing Decisions", and "Representative scenarios".

## Acceptance criteria

- [ ] Automated coverage exists for mixed `book`, `anime`, and `manga` overview responses across all three sections
- [ ] Automated coverage proves reread and rewatch latest-event transitions move items correctly between `Continue`, `Up Next`, and `Rate These`
- [ ] Automated coverage proves unknown totals preserve `Continue` membership with `currentUnits: null` and a usable label
- [ ] Unsupported or out-of-scope schemas are excluded by backend-owned rules rather than frontend filtering
- [ ] Missing or malformed built-in configuration fails predictably instead of silently returning incorrect section data

## Blocked by

- [Task 02](./02-frontend-overview-integration.md)

## User stories addressed

- User story 9
- User story 14
- User story 18
- User story 23
- User story 26
- User story 27
- User story 28
- User story 30
