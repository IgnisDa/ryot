# Definition Registry

This module owns the in-memory, slug-keyed snapshot of schema and source-canonical saved-view
definitions. Reads are synchronous. A replacement source is fully validated and frozen before the
single snapshot reference is swapped, so readers see either the previous complete snapshot or the
next complete snapshot.

The registry starts with `kernelDefinitionSource` and is populated from active plugin manifests by
`PluginLoader` before the server starts. Kernel definitions are source zero, not a synthetic plugin.
The generic notification script is persisted separately as a kernel-owned, content-addressed script.
The registry contains definitions and bindings only; user state and persisted domain data do not
belong here.
