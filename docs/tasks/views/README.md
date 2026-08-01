# Composable Views

## Tasks

**Overall Progress:** 8 of 13 tasks completed

**Current Task:** [Task 09](./09-handle-dependency-updates-safely.md) (todo)

### Task List

| #   | Task                                                                                                     | Status |
| --- | -------------------------------------------------------------------------------------------------------- | ------ |
| 01  | [Publish And Open Custom Pages](./01-publish-and-open-custom-pages.md)                                   | done   |
| 02  | [Compose Public Plugin Components](./02-compose-public-plugin-components.md)                             | done   |
| 03  | [Unify Plugin And Entity Pages](./03-unify-plugin-and-entity-pages.md)                                   | done   |
| 04  | [Browse Mixed Entities Automatically](./04-browse-mixed-entities-automatically.md)                       | done   |
| 05  | [Add Rich Domain Presentations](./05-add-rich-domain-presentations.md)                                   | done   |
| 06  | [Support Configured Queries And General Results](./06-support-configured-queries-and-general-results.md) | done   |
| 07  | [Complete The Collection Workflow](./07-complete-the-collection-workflow.md)                             | done   |
| 08  | [Preserve State During Live Refresh](./08-preserve-state-during-live-refresh.md)                         | done   |
| 09  | [Handle Dependency Updates Safely](./09-handle-dependency-updates-safely.md)                             | todo   |
| 10  | [Deliver The Complete Dashboard Journey](./10-deliver-the-complete-dashboard-journey.md)                 | todo   |
| 11  | [Unify Kernel Screen Data Access](./11-unify-kernel-screen-data-access.md)                               | todo   |
| 12  | [Replace Remaining Old Paths](./12-replace-remaining-old-paths.md)                                       | todo   |
| 13  | [Final Codebase Cleanup](./13-final-codebase-cleanup.md)                                                 | todo   |

Status: agreed system design, not a description of the current implementation.

The companion [tracer plan](./tracer.md) defines the complete first implementation. This document explains the system and its boundaries. It is design reference material; maintained product documentation belongs in the application and package documentation updated by that implementation.

## The Problem

V2 saved views currently combine a query with a fixed set of display slots. Every view supplies grid, list, and table definitions. This makes a show and a workout fit the same shape even though they need different information and interactions.

The limitation also reaches the data model. Saved views require entity rows, even though RyotQL supports other rows, grouped totals, and time series. Search, counting, identity, and pagination are tied to the fixed presentation.

V1 lists had useful domain behaviour: media actions, workout summaries, expandable content, and measurement charts and editing. V2 must make those experiences possible without moving media or fitness knowledge into the kernel. It must also support a user-created collection containing entities from several plugins.

## The Decision

A page is a React application running inside one sandboxed iframe. The application can contain components from several installed plugins and user-authored code. Those contributors trust each other and share one React runtime and SDK connection.

Saved views remain a user-facing concept. They become saved settings for a page, rather than three query-to-slot mappings.

The kernel keeps authentication, global navigation, native authority, and application lifecycle. The backend keeps enforcing user access. Contributors inside a page do not receive separate security compartments or permission prompts.

Do not execute custom code directly in the kernel document. Backend authorization does not protect the current user's browser credentials, storage, or native capabilities from code running in that document. The existing iframe and SDK boundary remains useful even when installed plugins are trusted.

## Terms

| Term             | Meaning                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| Page             | The React interface currently displayed inside the application shell       |
| Renderer         | React code that draws a page using supplied settings and data              |
| Saved view       | A named, stored choice of renderer, settings, and optional query documents |
| Presentation     | A reusable entity card or list item, including its domain data loader      |
| Public component | React code a plugin explicitly allows other pages to import                |
| Contributor      | A plugin or user-owned source package included in a page build             |
| Artifact         | Immutable HTML, JavaScript, CSS, and assets produced by a build            |

These are responsibilities, not a requirement to create a framework or service for every noun.

## One Page System

The same runtime serves several entry points:

| Entry point      | How its page is selected                                                     |
| ---------------- | ---------------------------------------------------------------------------- |
| Plugin route     | The plugin's route registration supplies a page and URL inputs               |
| Entity route     | The kernel resolves entity ownership and selects its owner's registered page |
| Saved-view route | A saved record supplies a renderer, settings, and data sources               |
| Workspace home   | The user's selected saved view, or the plugin's default home view            |

An entity detail page is a reusable page definition. It is not a saved-view database record created for each entity. The kernel continues resolving real entity provenance before opening it. Users cannot override the default entity detail page in this implementation, but can create other views of the same entity.

A plugin can ship a default workspace home as a saved-view definition. A user can select a different saved view for that workspace without editing the system plugin. The workspace URL stays the workspace URL; rendering a saved view there does not create another shell, header, iframe, or scroll container.

## Saved Views And Custom Code

A saved view stores its name, icon, navigation placement, renderer reference, settings, and optional named RyotQL queries. Navigation placement is separate from the plugins whose components or entities appear in the view.

There are three renderer sources:

- A maintained kernel renderer, initially the standard entity browser and a general results table.
- A page explicitly exported by an installed plugin.
- A user-owned custom renderer.

Custom renderer source is stored separately so several views can reuse it. It has one editable draft and one published version. Saving a draft does not change active views. Publishing validates and compiles the captured draft, then makes that version active. Failed publication leaves the previous published source unchanged. There is no version history, branch system, or rollback feature.

The published source still follows installed plugin versions. Keeping published source after a failed edit does not permit serving an artifact with outdated plugin dependencies.

The initial authoring surface is authenticated APIs and development tooling. There is no visual builder or browser code editor in the tracer. A future visual builder stores structured settings; it does not generate React source as its canonical format. Arbitrary custom code is not expected to round-trip into that builder.

## Plugin Exports

Plugins explicitly list public pages, components, and entity presentations. Each export has a stable local name and a source entry. Other contributors import only these public names, not private file paths.

Plugin pages and custom renderers use the same supported React, SDK, UI SDK, and source import policy. The new import mechanism adds public plugin exports, not arbitrary package installation or backend imports.

A plugin can register default grid and list presentations for its own entity schemas. A presentation owns its extra data loading and domain interface. It can show actions, open dialogs, expand, and run multi-step experiences. A full detail page can reuse the same public components.

Public exports follow the installed plugin source revision. There is no separate component version system. Removing or changing an explicit export can break dependent code; builds must report that clearly.

## Selecting And Displaying Data

Keep these jobs separate:

1. The selection query decides which results belong in the view, in what order, and where a page ends.
2. A presentation loader obtains the additional information its components need.
3. React displays that information and handles interactions.

For mixed entity results, the browser resolves each entity's schema and plugin ownership, groups entities by presentation, and loads presentation data in batches. It then renders results in the original selection order. Grouping requests by plugin must not regroup the visible list.

Grid and list layouts use domain presentations automatically. A missing automatic presentation uses a supported basic entity presentation. It does not guess domain property names or revive the old slot system.

Tables have explicit view-defined columns. Different plugins do not independently add incompatible columns to one table. The general results table can show non-entity rows when the view supplies a stable row key. An entity link is optional for general results.

Changing the entity browser's display style does not change result membership, sorting, or search meaning. Search and sort are explicit settings. Provider search is an explicit add action, not something inferred from a nullable view-wide schema field.

## Dashboards And Queries

Named data can contain rows, aggregates, and time series. An aggregate does not need a fake entity ID. A time series does not pretend to have row cursor pagination.

Stored query documents are useful for configurable pages. Custom React can also build queries from settings using existing RyotQL recipes. Domain components can own their detail queries. Not every query must be embedded in saved-view metadata.

The implementation extends existing SDK query hooks and typed recipe decoders. It does not add another cache library, query language, or language-level query parameters. A recipe can accept inputs and build an ordinary concrete RyotQL document.

The initial dashboard requires custom React. The tracer proves an aggregate widget and tests the general named-result path, including time series. It does not build draggable dashboard widgets or every possible chart.

## Refresh And Entity Interest

Entity interest tells Ryot which entities the user is viewing, so population and translation work can be prioritized and completion notifications delivered. It is not a subscription to every database change.

Several components can express interest in the same entity. The shared runtime combines their requests into the existing connection and limits. Detail content can use foreground priority; list content can use visible priority. Inactive screens stop requesting active-page work.

Successful SDK operations and collection mutations request a refresh of the active page's registered data. This includes the selection and aggregate queries, not only visible entity details. An action can add or remove a result from the selection.

The implementation keeps existing content while refreshing, combines repeated refresh requests, rejects stale responses after input changes, and preserves stable React keys. A data update must not reset an expanded row or erase form input.

Pages also refresh on return from the background, with duplicate-request protection. Standard page controls provide manual refresh. Entity notifications refresh the relevant interested queries. There is no promise of immediate updates for every change from another device or background job, and no default dashboard polling loop.

## One Data Surface

The kernel's own screens use the same query and mutation surface as pages. Two data-access models produced two answers to the same questions: page screens revalidated on return and kept content when a refresh failed, while kernel screens fetched once per navigation and had no notion of stale data. Freshness and error behaviour should not depend on which side of the iframe a screen happens to live.

The capability object remains the bridge contract, and most kernel work does not belong on it. Kernel screens talk to authenticated services that no plugin may call, so those services do not become capability categories that a plugin adapter cannot supply. Instead the shared React layer accepts host-supplied services, and the capability object grows only when a capability is genuinely shared.

Routes keep what routes are for. Access decisions, redirects, and not-found signals stay with the router, because they must happen before anything renders. Pre-authentication screens have no user scope and administrative screens use a different scope; both stay on the router path as named exceptions rather than reasons to weaken the boundary.

Screens that move gain caching and revalidation and lose route-level prefetching. That trade is accepted rather than bridged, because keeping a loader purely to warm the cache would restore the second data path this consolidation removes.

Plugin client code likewise has one import surface. The client SDK and UI SDK are that surface; the plugin kit is the backend and shared-source surface, and client code reaching it was an accident the compiler permitted rather than a supported arrangement.

## Operations And Trust

A page may invoke any operation exposed to the user by an installed plugin through the SDK. The target plugin is explicit; a component does not accidentally invoke an operation on the plugin whose workspace happens to be open.

The kernel supplies authentication and checks the target identity and revision. The backend validates inputs and access. Generic functions such as collection membership use semantic SDK methods backed by their existing kernel services, not direct HTTP calls from custom code.

Contributors in one document are trusted peers. Different SDK contexts are conveniences, not security barriers. The plan adds no per-component permission system.

## Building A Page

Build one application from the selected page entry and its public dependencies. Use one React instance, one SDK context, and one bootstrap. Contributor modules do not mount additional application roots.

A page importing specific components includes those dependencies. A page requesting automatic entity presentation additionally depends on the registered automatic presentation providers available to that user. Include their presentation exports and reachable imports, not every plugin page or backend source file.

This makes later pagination safe: a Pokemon appearing after a page of shows can already be rendered. Do not rebuild during pagination or load another executable module into the running application. A changed provider set makes a new application build necessary, just like a changed dependency revision.

Build identity includes the entry source, resolved contributor revisions, automatic-provider set, and compiler/runtime versions. Settings and query results are page inputs rather than executable source; changing those alone does not require recompilation.

Builds use the existing supervised compiler, limits, immutable artifact storage, and authenticated artifact-session approach. Publication builds eagerly; ordinary page opens build missing artifacts on demand. Catalog changes invalidate affected build identities rather than compiling every possible view immediately.

Styles and assets from reachable contributor modules are combined deterministically. Shared theme and framework styles are emitted once. Contributors share a DOM and CSS environment; authors must not assume private global styles.

## Updates And Failures

Views follow installed plugin revisions. They do not pin old plugin copies. A changed dependency is rebuilt on the next preparation or explicit reload. Do not serve an old artifact against different backend contracts.

An already-open application is not automatically replaced when a dependency changes. The kernel shows an update notice and lets the user reload. Operations targeting an outdated contributor revision are rejected. Existing in-memory content is not a promise that all old capabilities or artifact URLs remain available.

| Failure                                  | Behaviour                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| No automatic presentation exists         | Show the generic entity presentation                                         |
| One presentation load or render fails    | Contain the error, offer retry and a basic entity link                       |
| An explicitly imported export disappears | Fail the build with a named dependency error                                 |
| Custom source fails publication          | Keep the draft and the previous published source                             |
| Current dependencies cannot build        | Show a page-level build error; do not serve stale code                       |
| Whole page crashes                       | Show a page-level error and reload/retry                                     |
| Mutation fails                           | Keep the user's form state and show the failure; do not pretend it succeeded |

Artifact access keeps the existing user boundary. The difference is that authorization now checks an application with several contributors rather than one plugin installation. Existing token-based artifact URLs remain token-based; this is not a new security project.

## Navigation And Mobile

The kernel owns the one global history. SDK navigation identifies a plugin route, entity, or saved view explicitly. URL inputs that users should share or retain across reload belong in the URL; temporary form steps can remain in React state.

The tracer collection flow uses a pushed URL-owned dialog. Back closes it. Its choose, review, and confirm steps do not need separate URLs. App-local overlays also need shared Back handling rather than per-plugin shortcuts around the kernel.

Retained screens keep their state within one running document. Crossing to another application can dispose the previous document. Do not introduce a cache of hidden applications or promise arbitrary form-state restoration across that boundary.

The kernel continues supplying compact mode and safe-area values. Components must also adapt to their actual available width: a narrow desktop dashboard column is not a wide desktop page. Standard page and overlay components supply header, focus, scrolling, keyboard, and dismissal behaviour. Custom pages may choose their own content layout without nesting another application shell.

## First Implementation

The tracer is a user-owned dashboard, not a special fixture-only page. It imports public components from the system media and fitness plugins and the user's private fixture plugin.

It shows a mixed collection, counts by entity type, a reusable Pokemon picker, a persisted multi-step add-to-collection action, and a separate private `greet` operation. It can replace media home and navigate to show and Pokemon details. Automated data is deterministic and does not depend on live providers.

Rich new domain UI is limited to show, workout, and Pokemon. Existing shipped view definitions move to the new model and use generic presentation where no richer export exists. The old slot-specific contracts and runtime are removed. Development data may be reset; no compatibility reader remains.

## Not Included

- A visual view builder, browser code editor, dashboard widget editor, or renderer version history.
- Replacing the default entity detail page through user settings.
- Complete media logging, workout editing, or measurement editing workflows.
- Isolation between contributors inside a page, or custom code in the kernel document.
- Live executable module loading, automatic query dependency analysis, or continuous dashboard polling.
- A general unsaved-form navigation guard or persistence of arbitrary React state across application reloads.
- A rewrite of backend entity storage or an adapter for the old saved-view format.
