# Plugins

Plugins own package and installation state; `definitions` exposes their declarations and `scripts`
executes their code.

| Directory        | Owns                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `packages/`      | Archive validation, ingestion, system package sync, and immutable revisions   |
| `installations/` | Per-user installation lifecycle and availability                              |
| `configuration/` | Encrypted execution configuration and its revisions                           |
| `preferences/`   | Non-secret per-user settings                                                  |
| `catalog/`       | Resolved availability, readiness, rate-limit policy, and catalog invalidation |
| `operations/`    | Product-facing plugin operation entrypoints                                   |

Operation callers may supply their transport-owned expected OAuth resource. Authentication still resolves
the authoritative credential and user through `AuthService`; HTTP callers default to the API audience,
while the agent registry propagates the MCP audience for MCP calls. Admission, demo restrictions and
lifecycle locks use the same operation path.

## Operation results

An operation returns `{ output, changes? }`. It runs once through `ScriptCalls`, with no workflow,
journal, or workflow reference. Admission pins the decoded principal in the operation's idempotency
record.

When `changes` is non-empty, `OperationsService` commits it through `ChangeSets.commitScript` under the
operation's execution ID, with `api` or `integration` causation, initiator, and integration
attribution, so retries derive the same entity and event IDs. An invocation answers `PluginInvokeResult`
(`{ result, committed }`) to HTTP and agent tools alike. A keyed invocation records it inside the commit
transaction through `keyedReceipt`, after taking the key's lock, so a retry after commit returns it and
a concurrent retry commits nothing. Without changes, it is recorded after the run.

## Operation failures

`OperationsService` distinguishes a refusal from a crash. A script error whose boundary reason is
`operation-rejected` becomes HTTP 422 `PluginOperationRejected`, whose reason is the script's local
message stamped with the plugin's namespace. HTTP, page and agent-tool invocations, including
idempotent background submissions, share this dispatch. Every other sandbox failure remains HTTP 502
`PluginInvocationError` with `runtime-failed`, because proxies may replace 502 bodies and the client
treats them as transport failures.

Commit failures of returned changes map the same way: a policy rejection becomes 422
`PluginOperationRejected` with the policy's reason, a failure whose code is a `CommitConflictCode`
becomes 409 `PluginConflictError` with `changes-conflict` and that code, and any other invalid change
set is a plugin defect, reported as 502 `runtime-failed`.

## Message catalogs

Ingestion validates an archive's compiled catalogs: an `en` catalog is required, and every manifest
text key must name an `en` message whose arguments are exactly the ones the manifest binds (none for
plain display text). Catalogs count toward the revision content hash and
are stored per revision and locale in `plugin_revision_catalog`. Definition names and descriptions are
stored as messages stamped with the plugin ID as namespace; `plugin_revision` keeps the manifest's
local name and description, which RyotQL stamps when it reads them. Definition property schemas are
stamped the same way; revision-level schemas (configuration, user settings, provider search options)
keep their manifest text and are stamped by the recipes and resolver that serve them.

`GET /plugins/messages/:locale` returns exactly that locale's catalogs for the caller's listed plugins
at the active revisions of one catalog snapshot, without fallbacks. Inspection returns the archive's
catalogs limited to manifest text keys. `PluginMessageCatalogSourceLive` implements the platform
`MessageCatalogSource`, so `MessageRegistry` renders plugin messages from the active revision's
catalogs: in English for models, and in the recipient's locale for notifications. Messages of
inactive or removed plugins render `message.unavailable`.

## Repository composition

`packages/repository-layer.ts` owns `PluginRepositoryLive`, which provides the repository's client-artifact dependency. Automations planner, retention, and signal Layers use this focused composition without importing the plugins runtime Layer. Reusing the Layer preserves Effect's shared-resource composition.

## User plugin state

`DefinitionCatalog` reads a user's installations, their plugins, and the configuration revisions they
pin in one statement and derives listing, definition effectiveness, and executability in memory, so
every writer, including backup restore and one-time migrations, is observed without triggers.
Listed plugins include hidden and installing installations, but exclude incompatible ones.
Catalog operations resolve one `listPluginsAvailableToUser` snapshot and thread it through multi-row
work rather than rereading different catalog states. `listOperationsAvailableToUser` combines one
executable snapshot with a batched operation-script metadata read at its pinned revision IDs for the
agent tool registry. `PluginRuntimeResolver` combines that snapshot with each active revision's
decoded manifest sections, which it keeps per process by revision ID in bounded caches (256 revisions
each) because revision rows and their scripts never change. Executable lookups load only workflows,
operations, dependencies, name, and script hashes; listings additionally load the client section and
artifact imports. Catalog changes publish a transactional
`pg_notify` that clients use to refetch.

## Plugin artifacts and revision identity

System archives and private uploads contain a manifest, compiled backend JavaScript artifacts, and
optional compiled client assets. Compiled backend metadata identifies each entry, format, and JavaScript
hash. Archives contain no authoring source files or compiled `script.source`. Ingestion validates
archive structure and artifact hashes without compiler workers or source-provenance proof; hashes
establish internal consistency only.

Plugin revisions have no source file table. Their `contentHash` fingerprints the manifest, exact compiled
backend entry/format/JavaScript, and exact compiled client content. It identifies package content, not
proof that the metadata was derived from authoring source.

`metadata.packageId` is the immutable authored `publisher/name` ID. Persisted local plugin IDs identify scope and
owner; installation IDs identify per-user lifecycle and settings. Display names are metadata and
may change without changing either identity. Revisions are immutable and keyed by their content
hash, not their version label.

System activation quarantines private installations claiming its exact package ID under the
ingestion lock. Their records, configuration, references, and data remain intact. Quarantine records
`package-identity-conflict`; removing the system package does not recover them automatically.
Explicit re-enable validates the retained archive, configuration, declarations, and dependencies
before clearing quarantine. Package updates validate the submitted archive and compatibility with
the retained revision. Normal compatible upgrades do not drain admitted work.

## Private installation

Private installs, package updates, retained recovery, and `POST /plugins/inspect` share one candidate
validation: manifest policy, script entries, effective definitions, references, additive schema
evolution against an update target, and executable scripts. Inspect also checks dependencies and
returns the manifest summary without persisting anything. It reads the temporary upload without
claiming it, so the same token can then install or update; install and update claim and delete it.

A submitted `config` replaces the stored configuration. Omitted secrets keep their stored values, and
omitted non-secret fields fall back to schema defaults. Package updates without `config` revalidate
the stored configuration against the new schema.

`isInitialized` records successful installation bootstrap separately from availability and visibility.
Quarantine and ordinary revision changes preserve it. Explicit recovery of a completed installation
does not reseed it; incomplete recovery uses a fresh private activation token and the existing
installation job. Guarded lifecycle completion sets readiness and initialization together.

A bootstrap entry that declares entities runs no script. The user bootstrap and the installation job
hand it to the `PluginBootstrapEntities` port. The provisioning Layer binds the user bootstrap
dispatcher to the entity service; boot binds the port for job handlers. It ensures
the entities with kernel authority, under an execution ID keyed by the installation and entry, dated
at the installation's creation so a retry derives the same entities. The ensure returns the hook dispatch plans its
writes made, and the caller dispatches them after the ensure commits.

## System plugin synchronization

`PluginIngestionService` owns system plugin ingestion and environment configuration
resolution. Interactive installation resolves the installed plugin's environment
configuration in its ingestion transaction.

Boot uses `synchronizeSystemPlugins` to ingest all bundled sources with environment
resolution deferred. After ingestion completes, the service takes the ingestion lock
and resolves environment configuration once for every active system plugin. This bulk
pass includes plugins that are active but are not bundled by the current server build.

Callers must not add a separate boot-time environment resolution pass.

System config uses `RYOT_PLUGIN__<PUBLISHER>__<NAME>__<NORMALIZED_KEY>`, with package ID segments uppercased and `-` replaced by `_`.
Private config never reads environment values. The persisted catalog is authoritative and ingestion
is serialized.

Boot resolution sets `plugin.environment_config_revision_id` under the ingestion lock. Installation configuration pointer
activation uses the same ingestion lock. Retained executions use exact revision/configuration pins,
not current environment values. Automation hooks use stable plugin ID and authored hook slug;
scripts resolve by immutable revision ID, script slug, and content hash.

Ingestion readiness uses configured-key metadata from the exact revision and configuration owner,
without decrypting values. It checks availability, not ciphertext authentication. Startup validates
retained encryption-key references; execution configuration reads still authenticate ciphertext.

## User preferences

`userSettingsSchema` declares non-secret per-user preferences. `plugin_installation.user_settings`
stores explicit choices, while schema defaults supply missing values. `PluginUserSettingsWriter` owns
every write: it validates against the active persisted schema, caps the stored document at the sandbox
user-settings limit (64 KiB), locks asset references, and invalidates the user's catalog after commit. Installation-owned saves and
resets replace the document under the exclusive ingestion lock. A returned settings patch merges
top-level keys under the shared ingestion lock and the user write lock, after admitting the
subject's account. It resolves the installation from the plugin and execution user,
accepts only keys in the pinned revision's schema, and rejects uninstalled, inactive, or incompatible
installations at write time. Each patch invalidates the catalog. RyotQL exposes stored choices to the kernel preferences UI. Sandbox reads resolve the
execution user and plugin identity, applying the pinned revision's schema and defaults, and fail when
the resolved document exceeds the same limit, which bounds the read's result. These
preferences remain separate from encrypted configuration revisions and their redacted client
projections.

## Ingestion retirement

Uninstall commits an installation admission fence under the user write lock, then delegates
ingestion interruption, reconciliation, and payload/pin cleanup to the imports owner outside
the transaction. Only after cleanup does it tombstone the installation and record the uninstall
receipt. Retrying an interrupted uninstall retains the same fence and cleanup owners.

## Declared queries

`manifest.queries` is an optional record of `{ description, document }`, where `document` is an
authored, parameterized `PluginRyotQLDocument` whose parameter labels are manifest text, checked at
installation like other manifest text. Operation metadata is independent and retains its existing
shape. Ingestion validates all query branches and catalog-dependent controls against the effective
system/private definition set. A definition set is validated once, in the transaction that produces it:
kernel definition replacement at startup, a changed system package, uninstall, and installation changes.
An unchanged system package is not revalidated. The immutable `plugin_revision.queries` section is the runtime read
source; execution does not load the cold manifest. Readers resolve a declaration with
`resolvePluginDocument`, which stamps its labels with the plugin's namespace and binds `self`
references. User calls require the exact available installation;
pinned system scripts resolve their own declared queries at the retained revision.

`validateDefinitionSet` from `@ryot-app/definitions/definition-set`, with `kernelDefinitionSource()`
from `@ryot-app/definitions/kernel-definitions` and the complete available plugin set
`[{ id, manifest, scope }]`, is the definition validator. Scope defaults to `system`. It checks every
authored branch, resolves owners against that set, rejects unavailable or wrong-scope owners, checks
controls independently, and builds the definition snapshot. Invalid declarations throw.
`ryot plugin build` runs the same definition validator over the plugin and its declared dependency
closure; ingestion still validates every archive.

System package ingestion keeps its event loop free by running its CPU-heavy checks in a worker.
`PluginValidationWorker` is a pool of one `@ryot-app/compiler-worker` worker started from
`packages/plugin-validation-worker.ts` (`plugin-validation-worker.js` in the production build) and
speaking `packages/validation-worker-protocol.ts`. An ingestion leases the worker for its whole
operation, before it takes the ingestion lock so a lock holder never waits for the worker, and runs
two jobs on the one process:

- `checkSource` runs `checkPluginSource`: catalogs, integration and import schemas, compiled script
  matching, encoding and output audits, the client artifact, and the content hash.
- `validateDefinitionSet` runs `@ryot-app/definitions/definition-set-protocol` over the active system
  set inside the ingestion transaction.

In process stay the manifest decode, which the rest of ingestion (policy, schema evolution,
persistence and catalog invalidation) reads and Effect Schema cannot decode without its checks; the
deployment rules for active system packages, `validateSystemPluginDeployment` (unique package IDs,
configuration environment keys and HTTP rate-limit lookups); and each package's manifest references.
These run before the worker jobs and report the same errors in the same order as before. Boot's
kernel definition replacement runs through `validateActiveSystemPlugins`, which takes the lease
before the lock. User installations still check sources and definition sets in process through
`normalizePluginSource` and `buildValidatedDefinitionSnapshot`: their scoped validation blocks for 75
to 100 ms, while the worker would take about 290 ms warm or 450 ms cold, add its memory per install
and serialize concurrent users' installs behind one worker.

On the shipped Media archive an update's longest event-loop stall is about 160 ms, the in-process
manifest decode, down from 1.3 s; Fitness is about 40 ms. A failed check or invalid set keeps its
`PluginValidationError` and message. CPU time and memory above the worker limits also fail as
`PluginValidationError`; a worker that cannot start, exits, outlasts its elapsed-time limit or answers
with an invalid result fails with `CompilerWorkerUnavailable`, which ingestion raises as a defect so
its transaction rolls back like a database failure.

The worker exits when its lease ends. It peaks at 600 to 660 MB during a Media update and about 370 MB
for boot's full set. Nothing outlives a job; the peak is garbage from receiving and parsing the 30 MB
request and decoding the manifest, which the definition-set job then runs on top of, since Bun
returns little freed memory to the system. That memory would otherwise stay resident on a small server for an operation that runs at boot and on rare
administrative installs. Starting it costs about 130 ms.

Service integration tests use `RyotQLService.layer`, `isolatedDatabaseLayer`, and
`makeAppConfigLayer` from the explicit `modules/ryotql/service`, `testing/isolated-database`, and
`testing/effect` package entry points. Seed through the exported `platform/db/session` and
`schema/tables/combined` modules; fixtures must include the actual installation/revision authority.

`OperationsService.invokeTrusted({ userId, ...command })` is an internal user-operation entrypoint
for persisted server work. It reloads account authorization through `AuthService.resolveTrustedAccount`
and shares HTTP invocation's admission, runtime pins, validation, lifecycle hooks and replay. It
cannot dispatch integration-auth operations or carry page-frame authority. Registry source pins
add installation, revision and configuration constraints checked under the ingestion fence.
