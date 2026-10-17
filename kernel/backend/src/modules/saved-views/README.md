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
Saving a query binds portable package references once in the transaction's catalog snapshot.
Known entity-browser provider actions use an owner-qualified `schema`; authored settings may use
`self`, which definition materialization resolves to its exact local owner.
