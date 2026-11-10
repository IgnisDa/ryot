# Platform Extensions Plan — Pages, Publications, MCP, Private Plugins and Ryobot

Drafted on **2026-11-10** for the V2 beta. This plan adds five capabilities on one shared
foundation: user-authored code pages, custom publications, a Model Context Protocol (MCP) endpoint,
private plugin installation from the client, and **Ryobot**, an agentic assistant that reads and
changes the user's data and builds pages.

Ryot is greenfield: manifest shapes, bridge capabilities, wire schemas and SDK exports change in
place, with no compatibility paths. Backups follow the new shapes. Artifact, backup, manifest,
protocol, compiler and API version constants stay unchanged.

This is a minimum viable product built to be extended. Decisions that would be expensive to change
later (data model, manifest shape, principals, where keys and history live) are made properly now.
Protections that can be added later without reshaping anything are deferred and listed under
[Accepted limitations](#accepted-limitations).

## Product decisions

| Topic | Decision |
| --- | --- |
| Pages | A **page** is a first-class, user-owned client artifact: TypeScript/TSX source files, declared queries and plugin dependencies, compiled on the server when published. Pages are not plugins. Saved views and publications reference a page; neither owns it. |
| Page audience | Both developers and non-developers. Developers upload or paste source files; non-developers ask Ryobot. There is no in-app code editor at MVP. |
| Page writes | Pages may change data through plugin operations, like other saved views. Pages Ryobot creates or edits start **without write access**; the owner grants it once per page. Any later Ryobot edit removes the grant. |
| Saved-view backend | Complete from day one (create, update, clone and delete with page renderers), so Ryobot can build views itself. The client creator UI is minimal. |
| One way | Where possible there is one mechanism per job: one query style (static documents with parameters), one execution path for stored queries (by reference), one publication model (a page with bound arguments), and one visitor query path. |
| Queries | Every per-call value is a typed RyotQL parameter declared with `AppSchema` and bound on the server. Stored queries (saved views, declared plugin queries, page queries, publications) run by reference; callers send values, never documents. |
| Publications | Every publication is a page plus owner-bound arguments plus a mode. **Share** on a collection or entity-browser saved view publishes the kernel publication page bound to that source. Settings → Publications **Create** publishes one of the user's pages, replacing its current source picker. |
| Publication modes | Both, for every publication, chosen by the owner. **Live** runs the page's declared queries on each visit and is the default. **Snapshot** stores the first page of each query's results at publish time and serves only those; Ryobot suggests it for time-bound pages such as a yearly recap. |
| Visitor queries | Visitors may run only the published page's declared queries, with its declared parameters, as the owner, read-only. They never send RyotQL documents. The RyotQL publication scope is removed. |
| Operation schemas | The plugin manifest declares each operation's input and output schemas and safety hints natively. |
| Agent scripts | Ryobot and MCP clients may run TypeScript in the sandbox under a new **agent** principal: user-scoped RyotQL reads, and plugin operations through `invokeOperation`. No raw entity, event or relationship writes, and no `httpCall`. |
| MCP | One remote Streamable HTTP endpoint. Clients authenticate with an API key or OAuth (dynamic client registration plus a consent screen). Connecting self-hosted instances to AI apps (tunnels, Tailscale, HTTPS) is the operator's concern. |
| MCP tool set | Identical to Ryobot's: schema discovery, generic RyotQL, agent scripts, page and view tools, plugin-declared queries and operations. |
| Ryobot | A kernel feature; "Ryobot" is product copy, code uses `assistant`. The agent loop runs on the server. Users bring their own OpenAI-compatible provider; there is no token sale or credit system. Neither Ryobot nor agent scripts require Pro. |
| AI providers | The operator may set an instance default in server configuration (`SERVER_ASSISTANT_*`). Each user may add their own provider in Settings, which overrides the default. User keys are stored encrypted. |
| Chat history | Persisted per user until deleted, and carried by account backups. |
| Approvals | Ryobot asks before any write or destructive tool call, and before running an agent script that may write. MCP tools carry read-only/destructive hints, and approval is the MCP client's job. |
| Private plugins | Installable from Settings → Plugins with clear warnings: the plugin can read all of the user's data, change it, and contact any internet server. Auditing an archive is the user's responsibility. |
| Developer workflow | No CLI login or push commands at MVP. |

## Prior work to revive

Server-side client compilation and user-authored renderers existed until commit `8b7c18deae`
(2026-08-29, "load prebuilt artifacts without server compilation"). Its parent `b2596444bd` has the
complete implementation:

| Piece | Location at `b2596444bd` | Reuse |
| --- | --- | --- |
| Renderer draft/publish API: `POST /client-renderers`, `PUT /:id/draft`, `POST /:id/publish`, `DELETE /:id` | `packages/contract/src/modules/client-pages/contract.ts` | Shape of the page API |
| `ClientRendererDefinition` (entry, files as base64, settings schema, plugin dependencies) and errors including `build-failed` with diagnostics | `packages/contract/src/modules/client-pages/schemas.ts` | Basis of `PageDefinition` |
| `client_renderer` table (draft/published definition, revisions, published hash) and `saved_view.client_renderer_id` with `ON DELETE RESTRICT` | `kernel/backend/src/drizzle/20260920122549_volatile_the_spike/migration.sql` | Basis of the `page` table |
| Definition normalization, revision-fenced drafts, publish-time compile, `kind: "renderer"` composition contributor | `kernel/backend/src/modules/client-pages/{service,repository,routes}.ts` | Page service and composition |
| `ClientPluginCompiler`: subprocess compile with timeout, memory, output and concurrency limits | `kernel/backend/src/modules/plugins/client-plugin-compiler.ts` | Page compiler service |
| Compiler worker entry and wire protocol | `packages/client-plugin-compiler/src/{worker,protocol}.ts` | Re-add to `packages/plugin-client-compiler` |
| Renderer recipes and compiler smoke test | `packages/ryotql-recipes/src/client-renderers.ts`, `apps/server/scripts/smoke-compiler-workers.ts` | Page recipes and smoke test |

Still present today:

- `kernel/backend/src/platform/process/compiler-worker.ts`: the supervised subprocess runner.
- `kernel/backend/src/modules/scripts/registry/compiler.ts`: `SandboxCompiler`, a runtime sandbox
  TypeScript compiler referenced only by its own tests. Agent scripts use it.
- `Dockerfile` installs `vite-compiler`, `typescript-compiler` and `plugin-backend-compiler` into the
  runtime image and deletes `plugin-client-compiler` (line 74). Pages stop deleting it.
- `packages/plugin-ui-sdk` already ships charts, metric tiles, stat strips, shelves, timelines,
  tables and Markdown, which generated pages compose.
- `kernel/backend/src/modules/accounts/auth/service.ts` already configures Better Auth's OAuth
  provider with `consentPage: "/oauth/consent"`; no consent page exists because first-party
  clients skip consent.

## Workstreams

Dependencies: **A** and **B** are foundations, and **A**'s declared queries need **B**'s parameters.
**C** needs **A**. **D** needs **B**. **E** needs **B** and **D**. **F** needs **A**. **G** needs **A**, **C**, **D** and **F**. **H** is independent and can ship
first. Each workstream follows the repository workflow (checks, then affected tests, review,
cleanup).

### A. Operation schemas and the tool registry

**Manifest.** `PluginOperation` in `packages/contract/src/modules/plugins/manifest.ts` gains:

- `input` and `output`: JSON Schema documents generated from the operation's Effect Schemas. The
  schemas already live in `shared/` (for example `MediaActivityLogInput` in
  `plugins/media/shared/media-activity-operations.ts`), which the manifest may import. Plugin-kit
  provides one helper that converts a schema and rejects schemas that have no JSON representation.
- `hints: { readOnly, destructive, idempotent }`.
- A longer `description` written for both people and models.

Operation inputs stay JSON Schema rather than `AppSchema`: they use discriminated unions and
cross-field checks (for example `MediaActivityEntry` and `MediaActivityWhen`) that `AppSchema` cannot
express. Definition validation rejects missing schemas and conflicting hints. The operation invoke route
keeps validating input with the script's own Effect Schema; a plugin test asserts that the manifest
schema and the script schema describe the same input.

**Declared queries.** The manifest gains `queries`: named, described, parameterized RyotQL documents
(workstream **B** parameters) that plugins expose to agents, built from existing recipes at
manifest-authoring time. Tool descriptions are plugin copy; the kernel never names a plugin. The
initial set, which can change freely:

| Plugin | Declared query | Built from | Parameters |
| --- | --- | --- | --- |
| Media | `library-by-state` | `flatByLifecycleStateRecipe`, `episodicByLifecycleStateRecipe` | state, media types, paging |
| Media | `activity-history` | `mediaActivityRecipe` | period, media types, paging |
| Media | `title-history` | `mediaEntityHistoryRecipe`, `mediaPeopleRecipe` | title ID |
| Media | `reviews` | `mediaReviewActivityRecipe` | period, media types, paging |
| Media | `upcoming` | `upcomingRecipe` | days ahead |
| Media | `analytics-summary` | `mediaAnalyticsSummaryRecipe` | period, comparison period |
| Media | `analytics-trend` | `mediaAnalyticsTrendRecipe` | period, grouping |
| Media | `analytics-ranking` | `mediaAnalyticsRankingRecipe` | period, ranking kind, limit |
| Fitness | `workouts` | `fitnessAnalyticsWorkoutsRecipe` | period, paging |
| Fitness | `workout-detail` | `workoutDetailRecipe` | workout ID |
| Fitness | `exercise-history` | `exerciseDetailsRecipe` | exercise ID |
| Fitness | `personal-bests` | `recentPersonalBestsRecipe` | limit |
| Fitness | `analytics-totals` | `fitnessAnalyticsTotalsRecipe` | period, comparison period |
| Fitness | `analytics-trend` | `fitnessAnalyticsTrendRecipe` | period, grouping |
| Fitness | `analytics-ranking` | `historicalFitnessRankingRecipe` | period, ranking kind, limit |
| Fitness | `measurement-series` | `measurementSeriesRecipe` | metric, period |

The kernel adds `collections` and `collection-members` tools from the collections recipes.

**Registry.** A kernel `agent-tools` module assembles one tool list per user from the effective
catalog:

| Tool | Source | Hints |
| --- | --- | --- |
| `describe_data` | Effective entity, event and relationship schemas with properties and browse fields | read-only |
| `query` | RyotQL rows/aggregate documents in the user `plugin` audience, with row and byte caps; validation errors are returned to the caller | read-only |
| `run_script` | Workstream **F** | read-only, or destructive when `allowWrites` is set |
| `page_*`, `saved_view_*`, `publication_*` | Workstreams **D** and **E** | write |
| `<publisher>.<name>.<query>` | Declared queries | read-only |
| `<publisher>.<name>.<operation>` | `auth: "user"` operations, with manifest schemas and hints | from the manifest |

Results are truncated to a byte budget with a truncation marker. Demo credentials see only read-only
tools.

### B. RyotQL parameters and execution by reference

**Why.** Every caller builds and sends a complete document today:

- Recipes (205 definitions in 83 files) write per-call values into documents as literals.
- Saved-view renderers combine the stored document with search, filters, sort and cursor in the
  client (`packages/ryotql-recipes/src/saved-views.ts`).
- The kernel composes calendar-source and signal-schedule row sources itself.

That cannot serve callers who must not shape the query (publication visitors) or queries that live
on the server (declared queries, page queries, MCP tools). This workstream replaces all three
patterns with one model: **static documents with typed parameters, bound on the server.**

**One rule for every query.** A value that varies per call is a parameter. A recipe may still be a
function of structural inputs (plugin identity, schema references) that change *what* is queried.
All recipes convert to this style; literals remain only for true constants.

**Parameter declarations.** A document may declare `parameters`, an `AppSchema` shared by its
queries:

- **Allowed field types:** `string` (optionally with an `entity-id`, `event-id` or `relationship-id`
  reference), `number`, `integer`, `boolean`, `date`, `datetime`, `enum` and `enum-array` with static
  choices, and `array` of those.
- **Rejected:** objects, dynamic choices, assets, secrets, uploads and OAuth formats.
- **Taken from `AppSchema` as is:** labels, descriptions, `validation.required`, `defaultValue` and
  rules.
- **Reuse:** values are checked with `parseAppSchemaPropertiesSafe`. Declarations are validated
  with `validateAppSchemaDefinition` plus the subset check. Parameter forms render with the UI SDK's
  `schema-form`.
- **New in `packages/contract`:** `appSchemaJsonSchema` (used for MCP tool inputs) and type-level
  inference of an `AppSchema` literal's value type (used for SDK argument types).

**Controls.** A document may also declare `controls: { filter?, sort? }`, whose targets are:

- `{ kind: "browse", alias, schemas }`: the subject schemas' browse fields, resolved from the
  caller's definitions inside the execution transaction.
- `{ kind: "outputs", fields }`: filter fields over projected outputs, which replaces results-table
  `filterFields`.

`compileFilter` and `compileSort` move from `ryotql-recipes` into `@ryot-app/ryotql`, and the server
runs them. Controls are not `AppSchema` fields because their choices come from definitions.

**Placeholders.**

| Construct | Allowed in | Meaning |
| --- | --- | --- |
| `{ type: "parameter", name }` | Scalar expressions; `in.values` for list parameters; `dateBucket.bucket` and `timeZone` fields | The bound value with its declared kind |
| `{ type: "whenSet", parameter, predicate }` | Predicates | Applies only when the argument is set; otherwise `true`. Only for optional parameters without defaults |
| `{ type: "choice", parameter, cases }` | Scalar expressions, predicates, `orderBy` | The case for the chosen `enum` value; cases must cover every choice |
| `{ type: "filter" }` | Predicates | The compiled filter argument, or `true` when none is given |
| `{ type: "sort", otherwise }` | `orderBy` | The compiled sort argument, or `otherwise` |
| `{ type: "now" }`, `{ type: "dateAdd", expr, amount, unit }` | Scalar expressions | The executing clock and date arithmetic, so "the last 12 months" needs no client time |
| `{ type: "context", name: "reportingTimeZone" }` | `timeZone` fields | The executing user's reporting zone; for publication visitors, the owner's |

**Source entities.** A `sourceEntity` table reference reads a stored entity source: a collection's
members in collection order, or an entity-browser saved view's current results. Its columns are
`entityId` and `rank`, and a `string` parameter whose `reference` kind is `entity-source` selects the
source. It is the single way for one query to read another stored source's entities. Collection
detail, kernel publications and user pages all use it.

**Paging.** Documents keep a default and maximum `limit` per rows query but no cursors. The request
carries `pages: { [query]: { after?, limit? } }`, and grouped aggregate pages work the same way.
Cursors record the source identity, bound arguments, filter, sort and owner identity, so a cursor
reused with different arguments fails with `invalid-cursor`. The "persisted documents must omit
cursors" rule disappears because a stored cursor can no longer be expressed.

**Execution request.** Every RyotQL endpoint and sandbox `executeRyotql` take
`{ source, arguments?, filter?, sort?, pages? }`, where `source` is one of:

| Source | Used by |
| --- | --- |
| `{ kind: "inline", document }` | Kernel and plugin recipes, the MCP `query` tool, agent scripts |
| `{ kind: "savedView", reference, query }` | Saved-view renderers; the MCP saved-view tool |
| `{ kind: "plugin", packageId, scope, query }` | Declared plugin queries (workstream **A**) |
| `{ kind: "page", pageId, query }` | Pages (workstream **D**) |

Publication visitors use their own endpoint with `{ query, arguments?, filter?, sort?, pages? }`
against the publication's page (workstream **E**). A `describe` request returns a source's parameter
`AppSchema`, resolved filter fields and sort choices. Renderers, forms and MCP tool schemas all use
it, which replaces the client's `entitySchemaBrowseRecipe` and `entityBrowserControls` step.

**Binding pipeline.**

1. Decode the request.
2. Load a stored source under the caller's authority.
3. Check arguments against the parameter `AppSchema` and apply defaults.
4. **Bind:** substitute values, drop unset `whenSet` predicates, select `choice` cases, compile the
   filter and sort, resolve `now`, contexts and `sourceEntity`, and apply pages.
5. Run identity binding, validation, planning and execution, all unchanged.

The planner and executor never see placeholders.

**Validation at write time.** Stored documents are checked with placeholders treated as their
declared kinds, every `choice` case and `whenSet` branch validated, and control targets resolved.
That covers saved-view writes, manifest ingestion and page publishing, so authors (including
Ryobot) see errors when saving.

**Saved views.**

- Entity-browser and results-table documents declare their controls and parameters. Settings drop
  `searchFields` and `filterFields`, and gain `controls: { search?, filter?, sort? }`, naming the
  parameter or control that fills each part of the screen.
- On write, the kernel derives the `count` and `ids` named queries from the source query and stores
  them in the document. Renderers therefore run every query by reference, by name.
- The kernel keeps adding the subject-schema predicate for entity browsers.
- Removed: the client composition helpers (`entityBrowserSelection` and the client's use of
  `browserSearchPredicate` and `compileFilter`).

**Unchanged.** Calendar-source and signal-schedule row sources keep their kernel-composed windows,
which is what guarantees bounded scans.

**SDK.** `@ryot-app/ryotql` builders declare parameters and controls and return typed handles usable
as expressions. A recipe is a static document, a decoder and an inferred argument type, called as
`client.data.query(recipe, arguments)`. The client cache key is the document hash plus the canonical
request values, so query keys stay stable, including for rolling time windows.

**Order.**

1. Language, binding, paging and execution sources.
2. Saved views and kernel renderers.
3. Convert the remaining recipes in the kernel, Media and Fitness.

### C. MCP endpoint

- **Server:** `effect/ai` `McpServer.layerHttp` mounted at `/api/mcp`, registering the workstream
  **A** registry for the authenticated user. Tool annotations carry the manifest hints. Notifications
  for catalog changes are not part of the MVP.
- **API keys:** the existing `X-Api-Key` middleware authenticates MCP requests.
- **OAuth:**
  - Advertise protected-resource metadata in `WWW-Authenticate`.
  - Add `<FRONTEND_URL>/api/mcp` as an OAuth resource.
  - Enable dynamic client registration for public clients only.
  - Build the hosted `/oauth/consent` page.
  - First-party clients keep skipping consent; registered clients always see consent naming the
    client, its redirect origin and the `ryot:api` scope.
  - Verify discovery against Claude Desktop and one other client before calling it done.
- **Docs:** `apps/docs` documents the endpoint URL, API-key and OAuth setup, and that reachability
  from AI apps is the operator's responsibility.

### D. Pages

**Contract.** A new `pages` module in `packages/contract`:

- `PageDefinition = { entry, files, pluginDependencies, queries }`.
  - `files` are base64 `client/**` and `shared/**` sources and assets under the existing client
    compiler limits.
  - `queries` is one RyotQL document with parameters and controls (workstream **B**), validated when
    the page is published.
  - There is no settings schema; a page is self-contained.
- Endpoints:
  - Create a page with a draft.
  - Replace the draft (fenced by `expectedDraftRevision`).
  - Compile the draft, returning diagnostics without publishing.
  - Publish (compile and record the published definition, revision and artifact hash).
  - Grant or remove write access.
  - Delete.
- Errors revive `definition-invalid`, `draft-revision-stale`, `build-failed` with diagnostics,
  `dependency-unavailable` and `page-in-use`.

**Storage.**

- A `page` table with: user, slug, name, draft and published definitions, revisions, published
  artifact hash, `origin` (`user` or `assistant`) and `writeAccess`.
- Compiled artifacts use the existing generic `client_artifact` tables with private capability
  grants (`kernel/backend/src/modules/pages/bundles`).
- Deleting a page referenced by a saved view or publication fails with `page-in-use`.

**Compiler.**

- Re-add the worker entry and protocol to `packages/plugin-client-compiler`.
- Add a `kind: "page"` module input beside `plugin` and `kernel`, with the same import policy, AST
  checks and artifact identity rules.
- Revive `ClientPluginCompiler` as a kernel service on `platform/process/compiler-worker.ts`.
- Ship the compiler in the image by removing the `Dockerfile` deletion and copying its worker.
- Revive the smoke test.

**Composition.**

- `kernel/backend/src/modules/pages/preparation` gains a page contributor bound by page ID and
  published hash; its plugin dependencies resolve through the existing scoped package graph.
- Page artifacts load through capability grants like private plugin artifacts.
- Freshness includes the page's published revision.

**Saved views.** `SavedViewRenderer` adds `{ kind: "page", pageId }`. Page-rendered views carry no
data sources and empty settings. Create, update, clone and delete accept them. Views stay
user-owned rows in `saved_view`.

**Bridge and SDK.**

- `@ryot-app/plugin-client-sdk` adds `client.page.query(name, request)`, which runs the page's
  declared queries by reference.
- Page code reads data only through its declared queries, as the owner and as a visitor alike, so a
  page behaves the same when published. The bridge refuses inline documents from page frames. Cards
  render from presentation fields the declared queries select, through the SDK's presentation
  projection helpers.
- Operation requests from a page without `writeAccess` fail with a dedicated bridge error the page
  can display.
- Ryobot creating or editing a page sets `origin: "assistant"` and clears `writeAccess`; granting it
  is an owner-only command.

**Client.**

- Pages appear in navigation through their saved views.
- A minimal page screen shows:
  - Draft and published state, with upload or paste of source files.
  - Compile diagnostics and a live preview of the draft.
  - Publish, the write-access grant, and creating a saved view for the page.
- Ryobot covers most authoring.

**Backups.** Pages export their draft and published definitions with the published artifact bytes,
like private plugin archives, so restore needs no compiler. Saved-view and publication page
references are remapped on restore.

**Demo.** Page writes are demo-protected.

### E. Publications on pages

One publication model replaces today's source publications.

- **Model.** A publication is `{ page, arguments, mode }`:
  - `page` is a user page or the kernel publication page.
  - `arguments` are bound by the owner when publishing, for any of the page's parameters; visitors
    cannot change them.
  - `mode` is `live` or `snapshot`.
  - `PublicationSource` is replaced. Title, description, icon, owner-name choice, links, sessions,
    revocation and the instance switch keep their current behavior.
- **Kernel publication page.** The `publication` kernel renderer becomes a kernel page that declares
  `items`, `count`, `item` and `linked` queries. They read the bound collection or saved-view source
  through `sourceEntity`, and select only entity columns and presentation fields, preserving today's
  rule that visitors never see events or owner identity. **Share** on collection detail and
  entity-browser saved views publishes this page with the source bound. The visitor experience is
  unchanged.
- **Removed.**
  - The RyotQL `publication` scope and its `publication_subject` visibility rules.
  - `PUBLICATION_SUBJECT_LIMIT`.
  - The visitor endpoint that accepts RyotQL documents.
  - `publicationSubjectSchemasRecipe` and the other visitor-side recipes in `publication-browse.ts`.
- **Visitor queries.**
  - The visit endpoint takes `{ query, arguments?, filter?, sort?, pages? }` for the publication's
    page, with the publication's bound arguments overriding visitor values.
  - Live mode runs the query as the owner, in the `plugin` audience, in a read-only transaction.
  - Snapshot mode returns the stored result and rejects any other arguments, filter, sort or page.
  - Operation requests from visitor frames are refused.
- **Code exposure.** Publishing requires the page's plugin dependencies to be system plugins, so
  private plugin code is never exposed. Visitors receive a user page's own artifact through the
  session's grants, which the owner accepts by publishing it.
- **Snapshots.**
  - Publishing or republishing in snapshot mode runs every declared query with the bound and default
    arguments and stores each query's first page under a size cap.
  - **Refresh snapshot** is a republish.
  - Managed assets referenced by stored or live results are readable through the visitor asset
    endpoint.
- **Settings → Publications.** **Create** picks one of the user's published pages (collecting any
  owner-bound arguments with the parameter form) or starts a Ryobot conversation. Listing, links,
  preview, status, editing, stop sharing and deletion work the same for every publication.
- **Status.** A publication needs attention when its page is unpublished or deleted, its bound
  source is gone or is no longer an entity browser, a dependency becomes unavailable, or a snapshot
  exceeds its cap.
- **Backups.** Publications export with their page reference, bound arguments, mode and snapshot
  results, remap page and source references, and never carry links.

### F. Agent scripts

- **Principal:** `kernel/backend/src/modules/scripts/authorization/capabilities.ts` adds an `agent`
  subject: the user, with no plugin ownership. It gets `log`, `span` and `executeRyotql` (user
  `plugin` audience). Once `invokeOperation` exists, it gets that too when the run allows writes.
- **`invokeOperation`:** a new host capability that invokes an `auth: "user"` plugin operation
  through the existing operations service, with the operation's own validation, policies and hooks.
  Each call's idempotency key derives from the execution ID and call index, so a retried call does
  not repeat. Demo restrictions apply.
- **Compilation:** `SandboxCompiler` compiles the submitted TypeScript against a small agent SDK
  entry point (`@ryot-app/plugin-backend-sdk`) exposing RyotQL and operation calls. Compile
  diagnostics return to the caller.
- **Execution:**
  - One-shot executions under the existing sandbox time and memory limits.
  - Results are JSON, capped like other tool results.
  - Logs return with the result.
  - Runs are recorded for the user's history but are not durable workflows.
- **Order:** read-only scripts ship first; `invokeOperation` follows.

### G. Ryobot

**Module.** A kernel `assistant` module owns conversations, messages (text, tool calls, tool
results, approvals) and provider settings. It has a contract, RyotQL reads for conversation
listings, and backup export and restore.

**Providers.**

- `kernel/backend/src/platform/config/definition.ts` adds optional `SERVER_ASSISTANT_BASE_URL`,
  `SERVER_ASSISTANT_API_KEY` and `SERVER_ASSISTANT_MODEL`.
- Users may store their own base URL, model and key, encrypted with the existing configuration
  encryption key; the user's provider overrides the instance default.
- A provider is any OpenAI-compatible Chat Completions endpoint with tool calling and streaming,
  driven through `effect/ai` `LanguageModel` with an OpenAI-compatible adapter on the platform HTTP
  client.
- Provider traffic passes the egress address policy, so local model servers need
  `SERVER_EGRESS_ALLOWED_NETWORKS`.

**Loop.**

- Each user turn runs as a durable workflow that streams model output to the client through live
  updates and dispatches tool calls to the workstream **A** registry.
- Write and destructive calls, and `run_script` with `allowWrites`, pause the workflow until the
  user approves or declines in the client.
- Tool results are truncated to the context budget.
- A turn has a maximum number of tool rounds.

**Page generation.**

- The system prompt carries a generated reference for the client SDK and UI SDK (exports, props
  and examples), built from the SDK sources during the server build.
- Ryobot writes a page, compiles it, reads the diagnostics and repairs until it compiles, then shows
  a live preview inside the conversation.
- **Save** publishes the page and creates a saved view; **Share** opens the publication flow.
- Assistant-made pages start without write access.

**Client.**

- A kernel Ryobot destination with a conversation list, composer and streaming messages.
- Tool-call cards with approve and decline.
- Inline page previews through the existing iframe host.
- Settings → Ryobot for the user's provider.
- When no provider is configured, the destination explains how to add one.

**Demo.** Demo sessions cannot configure providers or approve writes.

### H. Private plugin installation

- **Inspect:** an endpoint takes an uploaded archive token and returns its validated manifest
  summary (name, package ID, version, description, operations, configuration schema) without
  installing.
- **Install flow:** Settings → Plugins gains **Install plugin**:
  - Upload the archive and show the summary.
  - Collect initial configuration with the existing schema form.
  - Install through `POST /plugins`.
  - Show existing installation errors in the panel's current error copy.
- **Warnings:** the flow states plainly that the plugin runs code with access to all of the user's
  data, can change and delete it, and can contact any internet server, and that Ryot does not verify
  publishers. The user confirms before installing.
- **Docs:** `apps/docs` documents installing and the same risks.

## Accepted limitations

These are known gaps accepted for the MVP. Each can be added later without changing the shapes
above.

- Private plugins and pages can read all of the user's data and contact any internet server, from
  backend scripts and from client code; there is no declared network access.
- Plugin and page iframes have no Content Security Policy.
- No per-user quotas on compilation, agent scripts or assistant usage. Compilation and sandbox
  concurrency limits still apply instance-wide.
- No operator switch to disable private plugin installation, and per-owner sidecar isolation stays
  opt-in.
- MCP OAuth uses the single `ryot:api` scope; there is no read-only scope and no connected-apps
  revocation screen. Users revoke access by deleting the API key or through account security
  actions.
- No publisher verification or signing for archives.
- No scheduled assistant runs, no in-app code editor, and no CLI login or push commands.

## Later extensions

These are listed so the MVP leaves room for them. They are not commitments:

- Declared network access and a CSP derived from it.
- Quotas, read-only and write scopes, and connected-apps management.
- Scheduled Ryobot runs delivered through notification channels.
- A plugin registry with publisher identity.
- An in-app editor.

## Documentation

Update `apps/docs` for pages, page publications, MCP setup, Ryobot providers and private plugin
installation. Update the READMEs of every touched module (`pages`, `publications`, `saved-views`,
`plugins`, `scripts`, `ryotql`, `accounts/auth`, the new `assistant` and `agent-tools`), the
`ryotql-recipes`, `kernel-renderers` and client SDK READMEs for parameters, controls and execution
by reference, and the plugin-kit README for operation schemas, hints and declared queries.

## Acceptance

- **A:** Media and Fitness manifests declare schemas and hints for every user operation; the
  registry lists them with declared queries; manifest and script schemas agree.
- **B:**
  - Parameters bind, apply defaults, and reject undeclared or mistyped values.
  - `whenSet`, `choice`, filter, sort, `now`, `dateAdd` and `sourceEntity` bind as specified.
  - Cursors from one argument set are rejected under another.
  - Stored documents with invalid branches are refused when written.
  - Saved views, collections and analytics run through parameters with no client-composed
    documents, and every recipe follows the one style.
- **C:** An MCP client lists and calls tools with an API key, and Claude Desktop connects through
  OAuth with dynamic registration and consent; first-party sign-in still skips consent.
- **D:**
  - Upload, compile with diagnostics, publish, view in navigation, edit and delete a page.
  - An in-use page cannot be deleted.
  - Write access gates operations and resets on a Ryobot edit.
  - Backup and restore keep pages working without recompiling.
- **E:**
  - Collection, saved-view and user-page publications render for visitors without an account, in
    live and snapshot modes.
  - Visitors can run only declared queries, cannot override bound arguments, cannot read events or
    owner identity through the kernel publication page, and cannot invoke operations.
  - Snapshot refresh replaces stored results.
  - A page with a private plugin dependency cannot be published.
  - The publications browser and API e2e files pass on the new model.
- **F:**
  - A read-only script aggregates history and returns JSON.
  - A script cannot write without `invokeOperation` and an approved run.
  - Retried operation calls do not repeat.
- **G:**
  - With an instance provider and with a user provider, Ryobot answers data questions using tools,
    asks before writes, and builds, previews and saves a recap page that can be shared as a
    snapshot.
  - Conversations survive restart and round-trip through backups.
- **H:** A user installs a private plugin archive with initial configuration after seeing the
  warnings, and the existing update and removal flows keep working.
