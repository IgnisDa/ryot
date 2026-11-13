# Publications

A publication binds a kernel publication page or an owned published user page to owner arguments
and a `live` or `snapshot` mode. Republishing atomically replaces its definition, presentation and
snapshot and increments the revision. User-page references use an owner-preserving composite foreign
key; deleting an in-use page fails with `page-in-use`, including revoked publications.

Live visits follow the latest published page. Visitors send only a declared query name and values;
the server chooses the document and runs under the owner's standard, plugin-audience authority in a
read-only transaction. `PublicationDefinition.visitorParameters` lists the parameters visitors may
change; owner `arguments` supply every other value and act as defaults for visitor parameters.
Visitor values for any other parameter must equal the owner's value or the request fails as
`invalid-query`, so owner values are never silently replaced. `bindPublicationArguments` in
`@ryot-app/contract` validates definitions for publishing, backups and the owner form: visitor
parameters must be declared, snapshots have none, and every other required parameter needs an owner
value or default. The kernel page's visitor parameters (`search` and `entityId` in live mode) come
from its recipe. User pages may deliberately
select owner data. The kernel page instead builds `items`, `count`, `item` and `linked` from the
canonical encoded `sourceEntity` reference and plugin-declared `entity` presentation sources.
The shared RyotQL executor resolves complete sources; declarations that read private columns or
related rows in entity scope fail plugin validation. Public cards omit owner progress, ratings,
and measurements. Both relationship endpoints remain inside the bound selection. Unset item
IDs produce empty item and linked results. No anonymous endpoint accepts query documents.

## Snapshots

Snapshot publication captures every declared query's first result page with bound/default arguments,
one database snapshot and one execution clock. Missing required arguments fail capture. The combined
response must fit 2 MB; failed capture leaves the previous publication intact. Snapshot reads never
execute a query or fall back to live data, and reject changed arguments, filters, sorts or pagination.
Refresh is a republish. Display metadata and the published page definition, revision, declaration
hash and compiled artifact hash are frozen with the results. The captured composition also freezes
all dependency exports and artifact identities, kernel renderer code, and runtime entries until refresh.
Capture persists image-owned artifacts alongside the already durable page and plugin artifacts.

`publication.definition` stores `PublicationDefinition`. The nullable `pageId` is its owned user-page
reference. `publication.snapshot` stores `PublicationSnapshot` from `model.ts`: `{page, document,
arguments, settings, result, composition}`. `page` is a nullable `PublishedPage` descriptor; user pages
include their source definition and artifact hash. `result` is the complete `RyotQLResponse` with capture clock and
all query results. `snapshotArtifactHash` mirrors `snapshot.page.artifactHash` for retention. Backups
must export every captured composition artifact and its metadata as well as these fields, remap
page/source and result asset references, and restore them without compilation. Links and sessions are never portable.

## Code And Assets

Visitor composition uses the ordinary page graph, import checks, dependency closure and capability
pipeline. Only system plugins enter its catalog, including system artifacts that require private
capability URLs. Owner-private plugin dependencies fail preparation. Snapshot visits assemble the
captured graph with the ordinary composition machinery; dependency updates or removed exports never replace captured code.
Each captured plugin must still be a ready system installation of the same package, so unavailable
dependencies report `dependency-unavailable` until eligibility returns or the snapshot is refreshed.
User-page frames always receive `writeAccess: false`. Artifact grants are scoped to the visitor session and publication revision;
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

Presentation data and its execution context are included in the snapshot response. Projection
revisions come from the captured client composition, so data and presentation code use the same
plugin revision. Entity cards do not execute fallback queries. Republish to recapture data after
changing a plugin's presentation contract.
