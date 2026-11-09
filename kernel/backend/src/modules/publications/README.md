# Publications

A publication is a read-only, live presentation of a subset of one user's entities. Its source is
either a kernel collection the owner has (its members, in collection order) or an entity-browser
saved view the owner can open (its current results, limited to the view's subject schemas). Sources
resolve on every request, so edits, additions, and removals, including changes to the saved view's
query, show up without republishing. Republishing replaces the title, icon, description, owner-name
choice, and source, and bumps `revision`. `SERVER_DISABLE_PUBLICATIONS` turns off publishing and every
visit without deleting anything.

## Subjects

Every visitor request first resolves the source to a RyotQL rows query and runs it as the owner, in
the `plugin` audience, inside the same read-only transaction as the visitor's query. The distinct
subject IDs, ranked by that query's order, become the subject set. More than
`PUBLICATION_SUBJECT_LIMIT` subjects refuses the request instead of truncating. A deleted collection,
a missing saved view, or one that no longer uses the entity-browser renderer makes the publication
unavailable. Visitor queries then run in the RyotQL publication scope (see the
[RyotQL README](../ryotql/README.md#scopes-and-visibility)), which only ever sees that set.

Creating or republishing evaluates the source first and refuses one that is unavailable or too
large. The owner-only `status` endpoint evaluates it the same way, so the owner can see the current
item count or why a publication needs attention.

Saved-view queries bind plugin references at execution time. Visitor queries may reference only
system plugins, and the visitor page composes only system plugins whose client artifacts are public,
so publications never expose private plugin code.

## Links And Sessions

A publication has any number of labelled links. A link secret is shown once and stored only as a
SHA-256 hash; it travels in the URL fragment (`/share/<publicationId>#<secret>`), so it never reaches
server logs or referrers. Visitors exchange it for a one-hour session stored by token hash in
transient values, which never outlives the link's expiry. Visitor requests carry the session in the
`x-ryot-publication-session` header and never establish a `CurrentUser`.

Every visitor request rechecks the instance switch, the publication and link revocation, link expiry,
and whether the owner is disabled, so revoking or expiring takes effect on the next request. Owner
previews are linkless sessions minted for the owner; they end only with the publication or session.

## Limits

Link exchanges are limited to ten per visitor address per minute, so one visitor cannot lock others
out of a publication. The address is the connection peer, or the client named by `X-Forwarded-For`
when the peer is one of `SERVER_TRUSTED_PROXIES`. Each session allows six concurrent reads, enough for
a page's parallel queries. These limits are per process. Visitor statements time out after ten
seconds and results are capped at 2 MB. Asset downloads resolve only for managed assets referenced by
a current subject's properties.
