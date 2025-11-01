# App Client Navigation And Media Queries

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate app-client navigation data and media/query consumers to the Effect client and pure backend query-language exports. This includes tracker and saved-view navigation loads, media overview query-engine calls, entity-schema list usage for media pages, and shared query field extraction helpers.

The goal is to remove app-client dependence on generated OpenAPI types and legacy query utilities for the main navigation and media data paths.

## Acceptance criteria

- [ ] App-client navigation loads trackers through the Effect client
- [ ] App-client navigation loads saved views through the Effect client
- [ ] Media overview query-engine calls use the Effect client
- [ ] Media overview entity-schema list calls use the Effect client
- [ ] Query expression builders are imported from pure backend public exports rather than legacy utility packages
- [ ] App-client tests/checks covering navigation and media query helpers pass or are updated to the new client model

## User stories addressed

Reference by number from the parent PRD:

- User story 19
- User story 46
- User story 47
- User story 51
