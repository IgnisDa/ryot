# RyotQL Recipes

Application recipes keep their result schemas, decoders, and decoded types next to each query.
They build documents through `@ryot-app/ryotql`; consumers use decoded results rather than parsing
generic rows.

Exact domain recipes take an explicit `PluginIdentityReference`. Authored saved views and trusted
sandbox calls may use `self`. Browser contributors supply their prepared local identity binding;
portable ad-hoc requests select a permanent `publisher/name` package ID and explicit `system` or `user` scope.
Definition joins compare both the local name and exact owner, with explicit null equality for kernel
definitions. A missing owner is not a kernel selector.

Generic cross-plugin entity reads and browser results remain broad. They carry each selected entity's
stored owner so presentation dispatch does not use the current workspace's identity. Kernel
collections and memberships are selected with explicit kernel predicates.

Runtime provider search takes an `EntitySchemaReference`.
Saved-view detail lookups take a tagged `SavedViewReference`; list filters use local plugin IDs, not
display slugs. Plugin catalogs expose permanent package IDs, local IDs, scope, and typed home views.

## Saved-View Recipes

Saved-view documents are authored RyotQL with descriptive field keys; settings name the source,
search, sort, and table-column fields, plus the `subject`: the entity table alias and the entity
schemas the view lists. The entity-browser recipes derive provenance from the subject. The page recipe
appends the entity ID, owner, schema slug, name, `populationStatus`, and `translationStatus` under
unused keys from the subject alias and decodes them into each item; both the page and count recipes
AND an owner-qualified subject-schema predicate into `where`, and the count uses `countDistinct` of the
subject alias ID. Authored sources therefore neither select nor map provenance or sync state, and the
schema constraint holds by construction. Registered entity presentations supply cards.
