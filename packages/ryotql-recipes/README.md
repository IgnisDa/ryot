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

Generated saved-view sources require an owner. Runtime provider search takes an `EntitySchemaReference`.
Saved-view detail lookups take a tagged `SavedViewReference`; list filters use local plugin IDs, not
display slugs. Plugin catalogs expose permanent package IDs, local IDs, scope, and typed home views.

## Saved-View Projections

Layouts project one table shape; registered entity presentations supply cards. Projections select
`populationStatus` and `translationStatus` under reserved keys declared in `saved-views.ts` and
decode them into each item's `sync`. These fields are intrinsic entity state, not configurable slots:
layouts neither map nor omit them. `validateMappedFields` checks only mapped fields, allowing the
extra selections. Projection helpers take the entity `TableReference` so sync columns use the same
table alias as the selected row.
