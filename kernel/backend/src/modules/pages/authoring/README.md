# Page authoring

`PageAuthoringService` owns page mutations; `PageAuthoringRepository` owns the `page` table.
The preparation module has separate owners (`PagesService` and `PagesRepository`). Row reads use
the kernel-only, owner-scoped RyotQL `page` catalog and the `pagesRecipe` / `pageRecipe` recipes.
The demo-protected `pageAuthoring` HTTP group exposes create, replace draft, compile, publish,
set write access and delete. It never accepts an actor or origin from the request.

Internal create and replace calls require `{ userId, kind: "user" | "assistant" }` supplied by the
trusted server caller. Both create paths start without write access. An assistant edit records
assistant origin, revokes any grant and increments `authorityRevision`. Owner-only grant/revoke
commands increment the same revision. Definition revisions and authority revisions are independent.

Draft replacement requires `expectedDraftRevision`, increments the draft revision and clears the
compiled draft metadata. Compile and publish check that revision before compilation, run the worker
outside a transaction, then lock and check it again before recording the result. The commit shares
the plugin ingestion fence and account write lock and rechecks declared dependency availability.
Publish additionally validates every stored query branch and its plugin identity references.
Published definitions, revisions, definition hashes and artifact hashes remain separate from drafts.

Compilation persists immutable page artifacts through `ClientArtifactsRepository`. The build result
contains the page ID, draft revision, definition hash and artifact hash; the page row also records
`draftCompiledRevision`. Later preview composition must match that revision to `draftRevision`, bind
query execution to the compiled draft, and enforce read-only execution. `PageDraftBuildIdentity` in the contract's `pages/identity`
module is the canonical `{ pageId, draftRevision, definitionHash, artifactHash }` fence.
`PagePreviewQuerySource` in `ryotql/request` extends it with `{ kind: "page-preview", query }`.
Resolution owner-scopes the page and checks all four values plus `draftCompiledRevision` before
returning a named draft query. Both draft and published sources run through the existing read-only
RyotQL execution transaction. The iframe host must bind this source to its prepared preview identity
and refuse operation calls; request values supply arguments, filters, sorts and paging. Published page sources select only named queries from the owned published definition;
the published revision and definition hash participate in cursor identity. Page code supplies query
values; page saved views do not own separate bound arguments, filters or sorts.

The `(id, userId)` unique key supports owner-preserving saved-view foreign keys. Delete translates
foreign-key reference failures to `page-in-use`. Reference constraints are owned by the referencing
feature; page authoring does not model publications.

Preparation can call `PageAuthoringRepository.findCompiledDraft(userId, PageDraftBuildIdentity)` to reuse the same owner-scoped compiled-draft fence as RyotQL preview sources; it returns `null` for any mismatch. `find` reads the complete owned row and `lock` locks it in the caller’s transaction.

`PageOperationAuthorization` owns the shared published-page write fence. Operation invocation locks
and rechecks the authenticated owner, published revision, definition hash, authority revision and
mutable write grant before dispatch or idempotent replay. The HTTP payload's `pageAuthority` is a
constraint, not a credential; the client host derives it from preparation.

Operations retain this constraint in the sandbox user subject. The existing workflow payload,
principal and inherited child subjects persist it through execution and recovery. Sandbox authority
rechecks it against the page row for each invocation and fresh host call, including durable dispatch.
Code/configuration pins and previously decoded principals do not preserve revoked page grants.

Trusted command callers may supply an idempotency key to create, replace, compile, publish and
remove. Each command fingerprints its actor/input and commits its result receipt with the page
mutation. Replayed replacement returns its original revision before applying the stale revision
fence again; replayed removal succeeds after the row is gone. Compilation runs outside the
transaction, while the build receipt and artifact/page reference commit atomically. Page writes
use account admission after the shared ingestion fence and account write lock.
