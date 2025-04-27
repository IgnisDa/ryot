# Ryot — Project Soul Document

> **Ryot** (Roll Your Own Tracker), pronounced "riot", is a self-hosted platform for tracking various facets of your life — media, fitness, and anything else you care about. This document defines what Ryot is, why it exists, and the principles that guide every decision made during its development.

**Last updated:** March 2026
**Status:** This is a living document. Update it as the project evolves.

---

## What is Ryot?

Ryot is a ground-up rewrite of the original Ryot application. The core mission remains the same — be the only self-hosted tracker you will ever need — but the architecture, data model, and scope are fundamentally new.

The original Ryot tracked media consumption and fitness. The new Ryot tracks *anything*. Movies, workouts, whiskeys, places, coffee, wine — whatever matters to you. It ships with curated, polished experiences for media and fitness, and gives you the tools to build your own tracker for everything else.

The elevator pitch: **A self-hosted personal data platform where every facet of your life — what you watch, what you lift, what you taste, where you go — lives in one place, owned entirely by you.**

---

## Why rewrite?

The original Ryot was built around a fixed set of entity types (movies, shows, books, etc.) with fitness bolted on. Every new trackable thing required code changes — new database tables, new API endpoints, new UI pages. This worked for media and fitness but couldn't scale to "track anything" without the codebase growing unboundedly.

The rewrite introduces a **schema-driven entity system** where entity types, their properties, their events, and their relationships are all defined as data, not code. A movie and a whiskey are both just entities with different schemas. This single architectural change unlocks the entire "track anything" vision without requiring code changes for each new thing a user wants to track.

---

## Core Principles

These are non-negotiable. Every feature, design decision, and technical choice should be evaluated against these principles.

### 1. Your data, your server, your rules

Ryot is self-hosted first. Users run it on their own hardware and own their data completely. A hosted cloud option exists for convenience, but the self-hosted experience is never degraded to push people toward the cloud. Core functionality works in both deployment models; optional Pro capabilities can be license-gated on self-hosted and are fully available on cloud plans.

### 2. Everything is an entity

This is the foundational data model decision. There are no special-case tables for movies, books, whiskeys, or exercises. There is one `entity` table. An entity belongs to an `entity_schema` that defines its shape. Events happen to entities. Entities relate to other entities. This uniformity is what makes cross-facet features (collections, saved views, the query builder, global search) possible without special-casing each entity type.

### 3. Curated where it matters, generated where it doesn't

Media tracking has specific UX expectations — poster grids, season/episode hierarchies, external metadata from TMDB. Fitness has its own patterns — workout session builders, progressive overload charts, rest timers. These deserve hand-crafted interfaces that feel as good as purpose-built vertical apps. User-created entity types get a schema-driven generated UI that is functional and clean but not hand-crafted. Users who create a "whiskey" tracker understand they're building something custom — their expectations are calibrated accordingly.

### 4. Facets are the organizing principle

A facet is a tracking domain — Media, Fitness, Whiskey, Places. Each facet owns one or more entity schemas, their event schemas, and their UI presentation. Facets can be enabled or disabled. The app adapts dynamically — a user tracking only whiskeys sees a focused single-purpose experience; a power user tracking ten things sees a rich dashboard. Media and Fitness are built-in facets that ship with the app. They are structurally identical to user-created facets — they just have hand-crafted UIs and pre-configured external data sources. No facet is assumed to exist. The sidebar, dashboard, quick actions, and every other surface are driven entirely by which facets are active.

### 5. The unified data layer is sacred

Facets are a UI/presentation concept. Underneath, the data model is unified. A collection doesn't care whether it contains movies, whiskeys, or places — they're all entities. The query builder doesn't care which facet an entity belongs to — it queries the same tables. Global search spans everything. This unified layer is what makes Ryot more than the sum of its parts. Never break this by introducing facet-specific data models that can't participate in cross-facet features.

### 6. Privacy is a feature, not a constraint

The target audience — self-hosting enthusiasts, quantified-self advocates, privacy-conscious users — chose Ryot specifically because they don't want their personal data in someone else's database. Every architectural decision should respect this. No external service calls without user awareness. No data leaves the instance unless the user explicitly configures an integration. If a social/community layer is added later, it must be strictly opt-in with granular sharing controls.

---

## Architecture Decisions

### Data Model: The Entity-Schema-Event Triad

The entire data model rests on three concepts:

**Entity Schema** defines a type of thing you can track. It has a name, a slug, a properties schema defining its shape, and configuration for whether it's built-in or user-created. A movie schema, a whiskey schema, and a "places I've visited" schema are all entity schemas.

**Entity** is a specific instance of a schema. Interstellar is an entity belonging to the movie schema. Lagavulin 16 is an entity belonging to the whiskey schema. An entity has a name, an optional image, properties (stored as jsonb validated against its schema's properties definition), an optional external ID (for things sourced from TMDB, IGDB, etc.), and a search vector for full-text search.

**Event** is something that happened to an entity. "I watched Interstellar" is an event. "I tasted Lagavulin 16" is an event. Events belong to an **Event Schema** that defines what properties the event captures (date watched, platform, rating, tasting notes, etc.). Events have a timestamp (`occurred_at`), properties (jsonb), and an optional reference to a session entity (for grouping events like sets within a workout session).

**Relationships** connect entities to each other. "Matthew McConaughey acted in Interstellar as Cooper" is a relationship with a source entity (McConaughey), a target entity (Interstellar), a relationship type (`acted_in`), and properties (`{ role: "Cooper" }`). Relationships enable the people-to-media connections, group/collection memberships, and any other user-defined connections between entities.

### Why AppSchema for properties?

Entity and event properties are stored as jsonb in Postgres and validated against a lightweight custom schema format called **AppSchema**. This decision was made because:

- **Simplicity**: AppSchema is a minimal, TypeScript-native format that defines property types (`string`, `number`, `integer`, `boolean`, `date`, `array`, `object`) with an optional `required` flag. No external dependencies or complex standards to integrate.
- **Data-driven definitions**: Property definitions are stored as data (jsonb) rather than requiring schema migrations for each new entity type.
- **Bidirectional conversion**: The `@ryot/ts-utils` package provides functions to convert between Zod schemas (used in code) and AppSchema (stored in the database), enabling type-safe validation at runtime.
- **Form generation**: AppSchema's simple structure can be consumed by UI components to auto-generate input forms for custom facets without heavy dependencies like `react-jsonschema-form`.
- **Full type coverage**: Supports strings, numbers, integers, booleans, dates, arrays (with recursive item types), objects (with nested properties), and required modifiers.

Example AppSchema definition:

```json
{
  "rating": { "type": "number" },
  "pages": { "type": "integer" },
  "title": { "type": "string", "required": true },
  "tags": { "type": "array", "items": { "type": "string" } }
}
```

The tradeoff: querying into jsonb is less efficient than querying typed columns. For the built-in facets where we know the property shapes ahead of time, we accept this tradeoff because the unified data model is more valuable than per-facet query optimization. If specific queries become bottlenecks, Postgres generated columns or materialized views can index frequently-queried jsonb paths without breaking the model.

### Why facets instead of just entity schemas?

An entity schema defines the shape of a single entity type. A facet groups related schemas and owns their UI presentation. The Media facet contains movie, show, book, podcast, video game, person, and group schemas. Fitness contains exercise, workout, and measurement schemas. A user-created whiskey facet contains just one schema.

Without the facet concept, the app would have a flat list of entity schemas in the sidebar with no visual or logical grouping. Facets provide:

- **UI routing**: the app knows whether to render a curated hand-crafted UI (Media, Fitness) or a schema-generated UI (custom facets).
- **Grouped navigation**: Media expands in the sidebar to show Movies, TV Shows, Books, etc.
- **Dashboard contributions**: each facet contributes widgets, stat cards, and quick actions to the home dashboard.
- **Enable/disable granularity**: turning off the Media facet hides all media-related schemas, not just one.

Facets are primarily a UI concept. In the database, the `entity_schema` table may have a `facet` or `facet_type` field, but the core entity/event/relationship tables don't know about facets at all.

### Collections are cross-facet by design

Collections are not constrained to a single facet. A "Trip to Japan" collection can contain movies, whiskeys, places, and books. This is one of Ryot's most compelling features — your life doesn't organize itself by data type.

Structurally, a collection is itself an entity (with a "collection" entity schema), and membership is modeled as relationships. This keeps collections within the unified data model rather than introducing a parallel system.

The Collections page in the sidebar is a built-in saved view that lists all collection entities. It follows the same pattern as "Movies" or "TV Shows" — clicking "Collections" navigates to a saved view with `queryDefinition: { entity_schema: "collection" }`. This means collections get the same browsing, filtering, and sorting capabilities as any other entity type, rendered through the unified saved view component.

For rendering mixed-entity collections, items display in a uniform card format: entity name, schema type as a colored badge, thumbnail if available, and most recent event summary. This is intentionally less rich than a facet-specific view — the value of a cross-facet collection is seeing the breadth of what's in it, not the depth of each item.

### Saved views are facet-scoped, collections are not

Saved views depend on the query builder, which needs to know property types to offer the right filter operators. Saved views can target one schema, multiple schemas, or full facets. Filters are schema-aware: operators are offered only where they are valid, and conditions against missing properties evaluate predictably rather than breaking the query.

The scope of a saved view (which schemas/facets it targets) is stored within its `queryDefinition` jsonb, not as a foreign key reference. This allows saved views to flexibly target multiple schemas or entire facets without requiring complex junction tables. The sidebar rendering logic determines which facet a saved view belongs under by examining its query definition.

Collections have no such constraint. They're just buckets of entities.

### Sandbox scripts as the extensibility layer

Scripts (stored in the `sandbox_script` table) are the primary mechanism for extending Ryot's behavior. A script is user-written or built-in JavaScript that runs in a sandboxed environment. Scripts serve multiple purposes:

- **Detail fetchers**: fetch and populate entity data from external APIs (TMDB, IGDB, Open Library, iTunes, etc.)
- **Automations**: trigger actions when events occur (move an entity between collections, send a notification, update a property)
- **Dashboard widgets**: query data and return structured output (stat cards, charts, lists, maps) for display on the home dashboard
- **Custom search sources**: add external search providers for entity creation

Each script has a `kind` that determines when and how it runs. Scripts receive a read-only database context and return structured data — they don't have direct write access or DOM access. When automations need to change data, scripts emit action intents that are validated and executed by core application services. This keeps scripts safe and predictable while still enabling controlled writes.

For dashboard widgets specifically, scripts return a render spec (type: stat/chart/list/table/map/progress, plus data) rather than HTML. The app handles all rendering. This ensures visual consistency and prevents scripts from breaking the dashboard layout.

Script execution is subject to timeouts (2 seconds for dashboard widgets), result caching, and rate limits for external API calls.

### No facet is assumed to exist

This is a critical implementation principle. Every surface of the app — the sidebar, the dashboard, the quick actions, the onboarding flow — must function correctly with zero facets, one facet, or twenty facets active. The dashboard is not "a media dashboard with some other stuff." It's a composable widget surface where each active facet contributes its pieces.

This means:

- The sidebar's TRACKING section is dynamically populated from active facets.
- Dashboard stat cards, quick actions, and the activity feed are assembled from what's available.
- The onboarding flow for a new user starts with "What do you want to track?" rather than assuming everyone wants media + fitness.
- A user who disables Media and Fitness and only tracks whiskeys has a first-class experience.

### Schema evolution without migration pain

Users will add properties to their schemas after creating entities. The rule for v1: **only additive, non-breaking changes are allowed through the UI.** Users can add new optional properties. They cannot delete properties that have data, change a property's type, or make an existing optional property required. This sidesteps schema migration entirely — existing entities simply don't have the new field yet, and that's fine because it's optional.

Power users who understand the implications can make breaking changes through raw database access, but the UI protects against accidental data loss.

### Entity list pages are pre-built saved views

The sidebar sub-items under a facet (Movies, TV Shows, Books under Media; Workouts, Measurements under Fitness; or the single entry for a custom Whiskey facet) are not custom-built pages. They are **pre-built, non-deletable saved views** that ship with each facet. The "Movies" page is a saved view with the query `entity_schema = movie` and zero additional filters. When a user adds filters, sorts, or changes the layout, they're interacting with saved view configuration.

This means there is no separate "entity list page" component. The saved view renderer *is* the entity list page. Custom facets get the exact same browsing experience for free — when a user creates a Whiskey facet, they automatically get a saved view in the sidebar that shows all whiskey entities.

In the database schema, saved views have an `isBuiltin` boolean flag. Views with `isBuiltin = true` cannot be deleted through the UI or API — this protects the essential entity list views that ship with each schema. User-created saved views have `isBuiltin = false` and are deletable.

The Collections page in the LIBRARY section follows this exact pattern. Since collections are entities (with a "collection" entity schema), the Collections page is simply a built-in saved view with `isBuiltin = true` and `queryDefinition: { entity_schema: "collection" }`. This architectural consistency means collections benefit from the same filtering, sorting, and browsing capabilities as any other entity type.

A saved view carries two pieces of configuration:

**Query definition** (jsonb) — the data query: which entity schema, what filters, what event-based conditions. This is what the query builder edits.

**Display configuration** (jsonb) — the presentation layer: default layout (grid vs table vs card list), which properties appear on cards, which filters are promoted to the filter bar, default sort order, and optional grouping. For example:

```json
{
  "layout": "grid",
  "card": {
    "image_property": "poster",
    "title_property": "name",
    "subtitle_properties": ["year", "genre"],
    "badge_property": "rating"
  },
  "promoted_filters": ["genre", "release_year", "rating"],
  "default_sort": { "field": "created_at", "direction": "desc" },
  "group_by": null
}
```

For built-in facets, display configs are hand-tuned — movies default to a poster grid with genre/year/rating filters promoted. For custom facets, the display config is auto-generated from the schema: the first image property becomes the thumbnail, name is the title, the first 2-3 properties become subtitle fields, and the first numeric property becomes the badge.

**Facet landing pages vs entity list views are distinct.** Clicking "Media" in the sidebar navigates to a facet overview — a dashboard-like widget surface with multiple sections ("In Progress," "Recently Watched," "Upcoming") composed from multiple saved view queries. Clicking "Movies" navigates to the single saved view for all movies. This separation is natural: overview pages answer "what's happening in this facet?" while entity list pages answer "show me everything of this type." Facet overview pages are curated for built-in facets and auto-generated (recent activity + stats) for custom facets.

The practical consequence of this decision: saved views are a core primitive, not a power-user feature. Every user interacts with saved views from their first session — they just don't know it. User-created saved views (via the query builder) are the same component with custom queries and display configs.

---

## Technical Stack

| Layer      | Technology        | Rationale                                                                                                           |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Frontend   | React             | Ecosystem maturity, PWA support, component library availability                                                     |
| Backend    | Hono              | Lightweight, fast, TypeScript-native, runs on Node.js                                                               |
| API        | REST with OpenAPI | Broad client compatibility, auto-generated docs, code generation for clients                                        |
| Database   | PostgreSQL        | jsonb support for dynamic schemas, full-text search (tsvector), battle-tested reliability, rich extension ecosystem |
| Job Queue  | BullMQ + Redis    | Background processing for API rate limiting, script execution, data enrichment, webhook delivery                    |
| Mobile     | Responsive PWA    | Single codebase, no app store gatekeeping, instant updates, aligns with self-hosting philosophy                     |
| Deployment | Docker            | Standard for self-hosted software, single-container simplicity with optional compose for Redis/Postgres             |

### Why not the original Ryot stack?

The original Ryot used a Rust backend. This rewrite moves to Hono (TypeScript) for several reasons:

- The scripting/sandbox system requires a JavaScript runtime. Having the backend in the same language simplifies script execution enormously.
- TypeScript allows sharing types, validation schemas, and utility code between frontend and backend.
- The development velocity for a schema-driven, JSON-heavy application is higher in TypeScript than Rust.
- The performance characteristics of the application (IO-bound API calls to external services, database queries, JSON manipulation) don't benefit significantly from Rust's computational performance advantages.

### API Design

The REST API is documented via OpenAPI and serves as the public integration surface. Every action a user can take in the UI has a corresponding API endpoint. This enables:

- Third-party integrations (Jellyfin, Plex, Kodi webhooks)
- User-built automations outside of the sandbox script system
- Future mobile apps if the PWA approach proves insufficient
- Import/export tooling

API keys with configurable permissions and rate limiting are supported.

---

## UI/UX Decisions

### Design language

Dark mode is the default and primary design target. The app feels like a personal analytics platform — data-rich, information-dense, but not cluttered. The aesthetic is premium and modern, closer to a developer tool or financial dashboard than a social media app.

**Color system**: a neutral dark base with facet-specific accent colors. Media uses violet, Fitness uses emerald, and user-created facets use amber/orange by default (customizable). This color-coding provides instant visual orientation — you always know which facet you're in.

**Typography**: clean sans-serif (Inter), semibold headings, ALL CAPS overline labels with letter-spacing for section headers. The type scale is restrained — large bold titles for page headers, medium weight for card headers, regular weight for body text, small muted text for metadata.

### Sidebar navigation

The sidebar is the primary navigation mechanism and is persistent across all screens. It has three sections:

1. **Top**: Home (cross-facet dashboard) and Global Search.
2. **TRACKING**: dynamically populated list of active facets. Built-in facets (Media, Fitness) are expandable with sub-items (Movies, TV Shows, etc.). Custom facets appear as single items. A "+ Add Tracker" link at the bottom is the entry point to create new facets.
3. **LIBRARY**: Collections and Saved Views. These are always visible regardless of which facets are active because they are cross-facet features.
   - **Collections**: Navigates to a built-in saved view (`isBuiltin: true`) that lists all collection entities with `queryDefinition: { entity_schema: "collection" }`. Uses the same saved view renderer as entity list pages.
   - **Saved Views**: Navigates to a management page that lists user-created saved views (`isBuiltin: false`), allowing users to browse, edit, and delete their custom views created via the query builder.

On mobile, the sidebar collapses into a bottom tab bar with the most-used items and a "More" overflow.

### Dashboard as a widget surface

The home dashboard is not a static layout. It's composed of widgets contributed by active facets, driven by scripts. Each widget is one of a fixed set of render types (stat card, chart, list, table, map, progress bar). Users can customize which widgets appear and their arrangement.

A user with only Whiskey active sees whiskey stat cards, a recent tastings feed, and whiskey-specific quick actions. A power user sees a dense grid of widgets from all their facets. The dashboard is never empty — it always shows at least the "Add Tracker" prompt for new users, and an activity feed plus stats for everyone else.

### Global search is cross-facet

The global search (Cmd+K / Ctrl+K) searches across all entities regardless of facet. Results are grouped: "In Your Library" shows entities the user has already tracked with their ratings and last event. "Global Search Results" shows matches from external sources (TMDB, IGDB, etc.) for built-in facets. A "Create New" option at the bottom lets users create an entity that doesn't exist in any source.

### Event logging: curated forms vs generated forms

For built-in facets, event logging uses hand-crafted forms. The "Log Watch" modal for a movie has purpose-built fields (date picker, platform dropdown, rating slider, review textarea) alongside contextual information (previous watches with ratings, total view count). These forms are designed to be fast — a user should be able to log a movie watch in under 10 seconds.

For custom facets, event logging uses forms generated from the event schema's AppSchema definition. The schema's type information controls widget selection (number input for `integer`/`number`, text input for `string`, date picker for `date`, etc.). These forms are functional but not as polished as the curated ones.

### Entity detail pages: curated vs generated

The Interstellar movie detail page has a cinematic hero section with backdrop, poster, metadata pills, a hand-crafted properties panel, cast/relationships section, activity timeline, and personal notes. This level of craft is only possible because we know what a movie looks like.

A whiskey entity detail page is generated from the schema: properties rendered as labeled fields, events shown as a timeline, relationships listed generically. It works well but doesn't have the cinematic flair of the movie page. This is the explicit tradeoff of the facet model — curated where it matters, generated where it doesn't.

### Visual query builder

The query builder is a stepped interface: (1) select the base scope (one schema, many schemas, or a facet), (2) add attribute filters on entity properties, (3) add event logic (aggregations on events). Results show as a live preview below the builder. Queries can be saved as views that appear in the sidebar.

The query builder is schema-aware, not single-schema-only. It supports multi-schema and facet-level queries while preserving type safety by exposing operators and fields that are valid for the selected scope.

Critically, the query builder is not a separate system from entity list pages. Every entity list page (Movies, Whiskey, etc.) is a saved view. The query builder is just the editing interface for a saved view's query definition and display configuration. When a user clicks "Save View" in the query builder, they're creating the same object that powers sidebar navigation. This unification means one renderer, one component, one data model for all browsing experiences.

---

## Monetization Model

Ryot follows a freemium, open-source model with two deployment options:

**Self-hosted (free):** Users run the open-source core on their own infrastructure. This includes the full entity-schema-event system, all built-in facets, custom facet creation, collections, saved views, the query builder, scripting, integrations, and the complete API. The free self-hosted experience is never artificially degraded.

**Self-hosted Pro:** Users purchase a license key to unlock additional features on their self-hosted instance. This is the same binary — the license key activates gated functionality.

**Cloud (hosted):** Ryot hosts and manages the instance for users who don't want to self-host. Cloud subscriptions include all features.

The specific features gated behind Pro are not defined in this document and will evolve based on what users value most. The guiding principle for the paywall boundary: **core tracking functionality is always free. Pro features enhance the experience (convenience, power-user capabilities, polish) but never hold basic tracking hostage.** A free self-hosted user should be able to track everything they care about without ever feeling like the app is incomplete.

The licensing model is GNU GPL v3.0, consistent with the `LICENSE` file in this repository.

---

## What Ryot is NOT

- **Not a social network.** There are no feeds, followers, or public profiles in v1. Social features may come later but will always be opt-in and secondary to the personal tracking experience.
- **Not a recommendation engine.** Ryot doesn't tell you what to watch or drink. It helps you track and reflect on what you've already chosen.
- **Not a data silo.** Import, export, and API access are first-class features. Users can always get their data out.
- **Not opinionated about what you track.** The built-in facets are starting points, not boundaries. If you want to track your houseplants, you can.
- **Not a Notion/Airtable competitor.** Ryot is purpose-built for tracking with events, timelines, and analytics. It doesn't try to be a general-purpose database or document editor.

---

## Development Priorities

This section guides what gets built first and what gets deferred.

### Phase 1: Foundation

The entity-schema-event data model, the REST API with OpenAPI, user authentication (including API keys), and the basic CRUD operations for entities and events. The schema builder UI for creating custom entity types. Basic dashboard with activity feed. Global search across entities.

### Phase 2: Built-in Facets

Media facet with curated UI: movie/show/book/podcast/game detail pages, logging modals, external source integration (TMDB, IGDB, Open Library, iTunes, etc.). Fitness facet with workout session logging, exercise database, body measurements. These need to feel as good as purpose-built vertical apps.

### Phase 3: Power Features

Query builder and saved views. Collections (cross-facet). Sandbox scripting system with dashboard widgets. Integrations (Jellyfin, Plex, Kodi webhooks). Import from existing Ryot instances and other services (Goodreads, Trakt, MyAnimeList).

### Phase 4: Polish and Scale

Dashboard customization (widget rearrangement). Mobile PWA optimization. Script marketplace or community sharing. Notifications system. Advanced analytics and visualizations. Performance optimization for large libraries.

---

## Guiding Questions

When making any product or technical decision, ask:

1. **Does this work with zero facets, one facet, and twenty facets?** If not, it's hardcoding assumptions.
2. **Does this stay within the unified data model?** If it requires facet-specific tables or queries that bypass the entity system, reconsider.
3. **Would a self-hosted user on a Raspberry Pi be okay with this?** Keep resource usage minimal. No heavy background processes without user opt-in.
4. **Can a user get their data out?** Every piece of data the user creates must be exportable.
5. **Is this a curated facet concern or a platform concern?** Curated facets (Media, Fitness) can have special UI. Platform features (collections, query builder, dashboard, search) must work generically across all facets.
6. **Can this be a saved view instead of a custom page?** Entity list pages are saved views. Before building a new browsing/listing surface, check if it's just a saved view with specific query and display configuration.
7. **Would this be better as a script?** If a feature is facet-specific and not universally needed, consider implementing it as a built-in script rather than core platform code. This keeps the core lean and proves the scripting system's utility.
