# Saved views

`definition_saved_view` owns built-in content. `saved_view` holds only custom user views, and
`saved_view_override` holds a user's hidden state and order for a built-in. The
`user_saved_view_effective` view combines these sources for navigation, page preparation,
plugin home selection, RyotQL, and backups. Changing a definition does not copy it into
each account. Overrides follow the same plugin identity and slug through revisions; an
unavailable definition does not appear in the effective view.

Custom views use their row IDs. Kernel views use a kernel reference and local slug; plugin views
use an exact local plugin ID and local slug. Custom slug uniqueness applies only to the custom
namespace. A custom view's installation is its workspace association, not its definition owner.
Built-in IDs frame the user, owner kind, owner ID, and slug, and remain stable across revisions.
Overrides have separate unique keys for kernel and plugin ownership.

Writes carry a tagged saved-view reference. Workspace associations use exact installation IDs.
Saving validates every authored branch and owner reference in the transaction's catalog snapshot; execution resolves those references again under current authority.
Known entity-browser provider actions use an owner-qualified `schema`; authored settings may use
`self`, which definition materialization resolves to its exact local owner.

Entity-browser and collection-browser settings declare a `subject`: the entity table alias the
source exposes and one or more owner-qualified entity schemas. Validation requires the alias to
resolve to an `entity` table in the source query, unique subject schemas, and any provider-search
`addAction` schema to be one of them. Materialization and backups resolve or map subject schema
owners the same way as `addAction` owners.

Renderer settings declare `controls: { search?, filter?, sort? }`. Search names a declared string
parameter; filter and sort enable the document's controls. Field definitions live in the authored
query document, rather than in renderer settings. Browse controls resolve effective schema declarations
on the server; results-table and membership controls may name another rows projection explicitly.

Custom rows and built-in definition rows persist validated bound `arguments`, plus saved `filter` and
`sort`. Required arguments are checked on save. Update bodies retain omitted selections; `null` explicitly
clears saved `filter` or `sort`. Arguments use an object replacement (`{}` reapplies defaults and
validates required parameters), while create and listed selections represent cleared controls by
absence. A source entity reads this saved selection, isolated
from the outer request's transient values. Runtime selection validation shares the execution pipeline,
including source authority, cycles and bounded materialization.

On authoring writes, the server adds the subject-schema guard and derives `count.count` and `ids.id`.
Entity-browser sources also receive the six shared reserved fields in
`contract/modules/saved-views/entity-browser-fields`. Authored collisions with these fields or
`count`, `ids`, and `librarySearchCount` are refused. An explicitly authored `librarySearch` receives
its own subject guard, reserved fields and derived `librarySearchCount.count`; search expressions and
ranking are never inferred. Clone and stored-form revalidation use an explicit trusted path and are
idempotent, preserving the server's own projections.

The renderer, data sources, and settings form a typed union in the write contract (`SavedViewRendererConfig`);
wire bodies and listed views stay flat. Write paths (service create, update and clone, manifest
materialization and validation, backup restore) decode with the typed settings and reject. Read paths
do not re-decode: the repository, definitions, page preparation, and the RyotQL saved-view source pass
the stored record through, so one malformed row never fails the list or navigation. It fails only where
a typed consumer, such as backup export, the kernel renderer, or the client saved-view route, decodes it.

The kernel `calendar` renderer is built-in only: definition snapshots require it to take no data
sources and empty settings, and neither manifests nor create, update, or clone bodies can name it.
The user-view validator, shared by create, update, and backup restore, rejects it outright, so a
custom calendar view cannot be written. Cloning the built-in Calendar fails with
`settings-incompatible`; hiding it uses the ordinary built-in override.

Custom page renderers use `{ kind: "page", pageId }` and reference only an owned published page.
They require null data sources, empty settings and arguments, and no saved filter or sort: page code
supplies query values. Create, update and clone share these constraints. The renderer JSON is the
single page reference; a generated `page_id` column supplies a composite foreign key with `user_id`
to the page owner. The database rejects cross-owner references and deletion of an in-use page.
