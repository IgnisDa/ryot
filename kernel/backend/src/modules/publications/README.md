# Publications

A publication binds a kernel publication page or an owned published user page to owner arguments
and a `live` or `snapshot` mode. Republishing atomically replaces its definition, presentation and
snapshot and increments the revision. User-page references use an owner-preserving composite foreign
key; deleting an in-use page fails with `page-in-use`, including revoked publications.

Live visits follow the latest published page. Visitors send only a declared query name and values;
the server chooses the document, overrides visitor arguments with owner bindings, and runs under the
owner's standard, plugin-audience authority in a read-only transaction. User pages may deliberately
select owner data. The kernel page instead builds `items`, `count`, `item` and `linked` from the
canonical encoded `sourceEntity` reference and system/kernel authored entity-browser presentation projections. Safe projection filtering shares the recipe policy after subject-alias rebasing; conflicting
projections fail readiness with a field-specific issue. It exposes no
owner/event columns, and both relationship endpoints remain inside the bound selection. Unset item
IDs produce empty item and linked results. No anonymous endpoint accepts query documents.

## Snapshots

Snapshot publication captures every declared query's first result page with bound/default arguments,
one database snapshot and one execution clock. Missing required arguments fail capture. The combined
response must fit 2 MB; failed capture leaves the previous publication intact. Snapshot reads never
execute a query or fall back to live data, and reject changed arguments, filters, sorts or pagination.
Refresh is a republish. Display metadata and the published page definition, revision, declaration
hash and compiled artifact hash are frozen with the results. A foreign key retains the frozen page
artifact even after the owner republishes the page.

`publication.definition` stores `PublicationDefinition`. The nullable `pageId` is its owned user-page
reference. `publication.snapshot` stores `PublicationSnapshot` from `model.ts`: `{page, document,
arguments, settings, result}`. `page` is a nullable `PublishedPage` descriptor; user pages include their
source definition and artifact hash. `result` is the complete `RyotQLResponse` with capture clock and
all query results. `snapshotArtifactHash` mirrors `snapshot.page.artifactHash` for retention. Backups
must export the frozen artifact bytes as well as these fields, remap page/source and result asset
references, and restore them without compilation. Links and sessions are never portable.

## Code And Assets

Visitor composition uses the ordinary page graph, import checks, dependency closure and capability
pipeline. Only system plugins enter its catalog, including system artifacts that require private
capability URLs. Owner-private plugin dependencies fail preparation. User-page frames always receive
`writeAccess: false`. Artifact grants are scoped to the visitor session and publication revision;
file delivery rechecks session/link expiry, revocation, owner disablement and the instance switch.

Managed assets are authorized only after they occur in a successful live result, with grants scoped
to the visitor session and publication revision, or directly from stored snapshot results. Guessed
locators are refused. Generic managed-asset retention scans publication snapshots, so removing a
source reference does not collect an asset still present in frozen results.

Kernel visitor settings carry `{mode, itemCount?, ownerName, description, browser, itemDetails}`.
`browser` and safe item-detail descriptors come from the canonical kernel publication recipe.
The publication presentation carries `mode`, as do context settings; user pages receive their published read-only frame authority.

## Links, Sessions And Limits

The instance switch disables publishing and every visit without deleting publications. Link secrets
are shown once and stored as SHA-256 hashes. URL fragments keep secrets out of request logs and
referrers. A link exchange creates a one-hour hashed-token session, bounded by link expiry. Owner
previews are linkless visitor sessions. Every HTTP request rechecks publication/link revocation,
expiry and owner disablement. Requests never establish `CurrentUser`.

Exchanges permit ten attempts per visitor address per minute, resolved through the authentication
module's trusted address handling. Sessions allow six concurrent reads. Query statements time out
after ten seconds; live responses and complete snapshot captures are bounded to 2 MB.
