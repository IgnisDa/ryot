# Saved View Display Contract

**Parent Plan:** [App Client Saved View Renderer](./README.md)

**Type:** AFK

**Status:** done

## What to build

Update the saved-view display configuration contract so the app-client can render saved views entirely from saved-view-declared runtime fields. This slice should make the backend contract match the parent PRD's display configuration decisions: a required root `entityIdProperty`, a required-but-nullable grid/list `eyebrowProperty`, non-null grid/list titles, and at least one table column.

The root `entityIdProperty` is system-owned and non-rendered. It is requested by clients for navigation, validates as a string/text expression, and defaults to the entity built-in ID expression for the saved view scope. The `eyebrowProperty` slot is a generic visible placement slot for grid/list and defaults to entity schema name. There is no production data migration requirement; update seeds, bootstrap/defaults, fixtures, and tests instead of adding compatibility backfills.

App-frontend behavior is not product scope for this plan, but shared backend contract changes may require mechanical type or compile fixes outside app-client.

## Acceptance criteria

- [x] Saved-view display configuration includes required root `entityIdProperty`
- [x] Grid and list display configurations include required `eyebrowProperty` keys whose values may be null
- [x] Default saved-view display configurations set `entityIdProperty` to entity built-in ID and `eyebrowProperty` to entity schema name
- [x] Backend validation rejects `entityIdProperty` expressions that do not resolve to string/text values
- [x] Backend validation rejects grid/list display configurations with null `titleProperty`
- [x] Backend validation or schema parsing rejects table display configurations with zero columns
- [x] Saved-view create/update API behavior rejects invalid display configurations before persistence
- [x] Backend defaults, bootstrap paths, fixtures, and tests are updated for the new required fields
- [x] App-frontend is only changed if required by shared type/schema compile fallout

## User stories addressed

Reference by number from the parent PRD:

- User story 26
- User story 27
- User story 28
- User story 29
- User story 30
