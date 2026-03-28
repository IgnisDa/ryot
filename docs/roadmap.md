# Ryot Implementation Roadmap

This document describes the intended implementation path for Ryot as a product and platform. It is derived from `docs/soul.md` and is meant to stay useful even as day-to-day progress changes.

## Purpose

Ryot is not being built as a collection of isolated trackers. It is being built as a unified personal data platform where media, fitness, and user-created trackers all sit on the same entity-driven foundation.

The roadmap therefore follows dependencies in the product model:

1. Build the unified platform primitives.
2. Prove them through curated built-in experiences.
3. Expose them as generated tools for custom trackers.
4. Layer cross-tracker power features on top.
5. Add extensibility, polish, and scale work without violating the core model.

## Non-negotiable implementation principles

Every phase should preserve these rules from the SOUL document:

- Trackers are the organizing principle, not the storage model.
- Everything important remains inside the unified `entity_schema -> entity -> event -> relationship` layer.
- Built-in trackers may have curated interfaces, but they cannot require a separate data architecture.
- Custom trackers must work through generated schema-driven experiences.
- No part of the app may assume Media or Fitness exists.
- Saved views, collections, search, and scripts must work across trackers rather than inside silos.
- Sandbox scripts extend the platform; they do not replace core product capabilities.

## Implementation phases

### Phase 1: Core platform foundation

This phase establishes the base model and the minimum application shell.

#### Goals

- Define the unified data model for entity schemas, entities, events, and relationships.
- Expose the core model through a consistent REST API with OpenAPI.
- Build authentication, authorization, and API-key support.
- Establish the frontend application shell and shared navigation patterns.
- Support the minimum CRUD flows needed to create, read, update, and delete tracked data.

#### Deliverables

- Database schema and services for the entity system
- API surface for core CRUD operations
- User accounts and API keys
- Global application shell
- Baseline dashboard and activity feed
- Global search foundation

### Phase 2: Trackers as the organizing layer

This phase introduces trackers as the product-level grouping and navigation concept.

#### Goals

- Model built-in and custom trackers consistently.
- Make the application shell adapt to active trackers.
- Support tracker creation, update, enable, disable, and ordering.
- Ensure every navigation surface works with zero trackers, one tracker, or many trackers.

#### Deliverables

- Tracker backend model and API
- Tracker management UI
- Dynamic tracking navigation
- Built-in tracker registration and lifecycle rules
- Custom tracker creation flow

### Phase 3: Curated built-in trackers

This phase proves that Ryot can ship high-quality vertical experiences without breaking the shared platform.

#### Goals

- Build Media and Fitness as first-class built-in trackers.
- Deliver hand-crafted detail pages, list experiences, and event logging flows for these domains.
- Integrate external metadata sources where they improve the built-in experience.
- Keep all built-in behavior anchored to the same unified data model.

#### Deliverables

- Media tracker schema set and curated UI
- Fitness tracker schema set and curated UI
- Built-in event logging flows
- External search and detail fetch integrations for built-in domains
- Built-in saved views and overview pages

### Phase 4: Custom tracker platform

This phase turns Ryot from a product with built-in trackers into a true "track anything" platform.

Current rewrite status: the custom-tracker shell now matches the SOUL model. Tracker root routes render generated overview pages for non-empty custom trackers, empty trackers stay in the guided setup flow, schema-level browsing continues to live in saved views under the tracker, and generated entity detail pages now have a proper journal-style identity header, property rendering, and activity timeline instead of the earlier placeholder treatment.

#### Goals

- Allow a user-created tracker to own one or more schemas.
- Let custom trackers start empty and support user-managed entity and event schemas.
- Generate entity creation, editing, browsing, and detail experiences from schema definitions.
- Generate event logging flows from event schemas.
- Ensure custom trackers receive the same structural benefits as built-in trackers, even if the UI is less curated.

#### Deliverables

- Schema builder for custom trackers, including entity and event schema management
- Generated entity CRUD
- Generated event logging
- Generated entity detail pages
- Default saved views for custom trackers
- Generated custom tracker overview pages

### Phase 5: Saved views and query-driven browsing

This phase establishes saved views as the universal browsing primitive for Ryot.

#### Goals

- Make entity list pages saved-view-backed across the product.
- Build the schema-aware query builder.
- Support saved views scoped to schemas, multiple schemas, and trackers.
- Support display configuration for grid, table, list, grouping, promoted filters, and sorting.

#### Deliverables

- Saved view data model and API
- Saved view renderer
- Visual query builder
- Sidebar integration for built-in and user-authored saved views
- Display configuration editing

### Phase 6: Cross-tracker power features

This phase makes the unified data model visible to users through features that intentionally cross tracker boundaries.

#### Goals

- Build collections that can mix entities from any tracker.
- Strengthen global search across the whole library.
- Build dashboards that aggregate contributions from active trackers.
- Support cross-tracker browsing, grouping, and reflection workflows.

#### Deliverables

- Collections as entities plus relationships
- Mixed-entity collection rendering
- Stronger global search UX
- Cross-tracker dashboard composition
- Cross-tracker quick actions and activity surfaces

### Phase 7: Scripted extensibility and integrations

This phase uses the sandbox system to make the platform extensible without turning the core into a pile of one-off code.

#### Goals

- Support built-in and user-authored sandbox scripts.
- Use scripts for dashboard widgets, detail fetchers, automations, and search sources.
- Enforce execution limits, safe host functions, and predictable return contracts.
- Make scripts an extension mechanism, not a shortcut around core architecture.

#### Deliverables

- Script registry and lifecycle rules
- Built-in widget scripts
- Detail fetcher scripts
- Automation hooks
- Custom search source scripts
- Script execution policies, caching, and failure handling

### Phase 8: Product hardening, polish, and scale

This phase makes Ryot durable for long-term daily use across self-hosted setups of different sizes.

#### Goals

- Improve mobile PWA usability and responsiveness.
- Support dashboard customization and personalization.
- Improve performance for large libraries and high event volumes.
- Add import and export workflows.
- Add notifications, analytics, and operational hardening where they fit the product.

#### Deliverables

- Mobile PWA improvements
- Widget arrangement and dashboard personalization
- Import and export tooling
- Performance optimizations for search and browsing
- Notifications and advanced analytics
- Operational observability and resilience improvements

## Cross-cutting tracks

These tracks span multiple phases and should be advanced whenever the underlying phase makes them possible.

### Search

- Global search across all entities
- External source search for built-in trackers
- Create-new flows when no external source exists

### Navigation

- Dynamic sidebar driven by active trackers and saved views
- Custom tracker overview routes versus list routes
- Mobile navigation that still respects the tracker model

### Data safety and evolution

- Schema evolution rules for additive, non-breaking changes
- Exportability of all user-created data
- Privacy-preserving defaults and explicit integration consent

### Generated UI system

- JSON Schema-based form generation
- Display hints via schema metadata
- Reusable renderers for properties, event timelines, and schema-backed layouts

### Extensibility

- Sandbox runtime and host-function boundaries
- Built-in script library
- Future automation and integration hooks

## Definition of done by phase

A phase is not complete just because one happy-path demo exists. Each phase should satisfy the following before the project leans heavily on it:

- The phase works with zero trackers, one tracker, and many trackers where applicable.
- The phase uses the unified data model rather than bypassing it.
- The phase is represented in both API and frontend behavior where needed.
- The phase has basic verification coverage for the critical flows it introduces.
- The phase does not hardcode built-in tracker assumptions into generic surfaces.

## Master checklist

This checklist is intentionally broad. It is a project-level implementation checklist, not a sprint plan.

A box is checked only when the capability is clearly implemented in the current rewrite stack or as reusable infrastructure for that stack. Legacy-app-only implementations are not counted here.

### Core platform

- [x] Unified entity, event, schema, and relationship model
- [x] Core REST API with OpenAPI
- [x] Authentication and API keys
- [x] Global app shell
- [ ] Baseline dashboard and activity feed

### Tracker system

- [x] Tracker backend model and API
- [x] Tracker frontend management flows
- [x] Dynamic tracking navigation
- [x] Built-in and custom tracker enable and disable flows
- [ ] Built-in tracker registration model completed
- [ ] Tracker overview pages for all supported tracker types

### Built-in curated trackers

- [ ] Media curated experience
- [ ] Fitness curated experience
- [x] Built-in external metadata integrations
- [ ] Built-in saved views and landing pages

### Custom tracker platform

- [x] Custom entity and event schema builder
- [x] Generated custom entity CRUD
- [x] Generated custom event logging
- [x] Generated custom entity detail pages
- [x] Generated custom tracker overview pages
- [x] Default saved views for custom trackers

### Saved views and query builder

- [x] Saved view data model
- [ ] Saved view renderer
- [ ] Visual query builder
- [ ] User-authored saved views
- [ ] Display configuration editing

### Cross-tracker power features

- [ ] Collections
- [ ] Strong global search UX
- [ ] Cross-tracker dashboard composition
- [ ] Cross-tracker quick actions

### Scripts and integrations

- [x] Sandbox runtime foundation
- [ ] Built-in dashboard widget scripts
- [x] Detail fetcher scripts
- [ ] Automation scripts
- [x] Custom search source scripts
- [ ] Script execution governance and caching

### Hardening and scale

- [ ] Mobile PWA optimization
- [ ] Dashboard customization
- [ ] Import and export tooling
- [ ] Notifications
- [ ] Advanced analytics
- [ ] Performance optimization for large libraries

## Summary

Ryot should be implemented as a layered system:

1. Unified platform first
2. Tracker organization second
3. Curated built-in experiences and generated custom experiences on top of the same model
4. Cross-tracker power features next
5. Sandbox-driven extensibility and long-term polish after the platform can carry them

That sequencing preserves the product's main promise: one self-hosted place to track anything, without turning every new domain into a custom engineering project.
