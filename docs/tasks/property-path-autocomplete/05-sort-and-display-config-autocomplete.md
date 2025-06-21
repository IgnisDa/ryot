# Sort Field + Display Config Property Path Autocomplete

**Parent Plan:** [Property Path Autocomplete](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Extend `PropertyPathAutocomplete` (Task 02) to all remaining property path inputs in the saved view editor: sort field inputs and all display configuration property path inputs.

**Sort builder:** Add a `schemas` prop to `SortBuilder`. Replace each sort field `TextField` with `PropertyPathAutocomplete` using `excludeImage: false` (`@image` is a valid sort target — only the filter context excludes it). The `schemas` prop flows from `SavedViewExtendedForm` → `SortBuilder`. Remove the now-redundant built-in path help text from `SortBuilder` since the autocomplete options make it self-evident.

**Display config:** Add a `schemas` prop to `DisplayConfigBuilder` and thread it through to `PropertyArrayEditor`. Replace each property path `TextField` in `PropertyArrayEditor` with `PropertyPathAutocomplete` using `excludeImage: false`. This covers all six positions: grid image/title/badge/subtitle, list image/title/badge/subtitle, and table column property paths.

Both replacements reuse the same `PropertyPathAutocomplete` component and the same `schemas` prop already being fetched in `SavedViewExtendedForm`. No new hooks or data fetching is required.

## Acceptance criteria

- [ ] Sort field inputs show schema-grouped property suggestions including `@image`
- [ ] Sort field inputs are disabled with "Add entity schemas first" when no schemas are selected
- [ ] All display config property path inputs (grid, list, table column) show schema-grouped suggestions
- [ ] `@image` is present in display config property path suggestions
- [ ] Display config property path inputs are disabled with "Add entity schemas first" when no schemas are selected
- [ ] Free-text entry still works in all replaced inputs
- [ ] Help text describing path syntax is removed from `SortBuilder` (autocomplete makes it redundant)

## Blocked by

- [Task 02](./02-property-path-autocomplete-component.md)

## User stories addressed

- User story 12 (sort field property path autocomplete)
- User story 13 (display config property path autocomplete)
- User story 15 (@image included in sort and display config suggestions)
