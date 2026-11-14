# Client Plugin Contract

- Dependency on `@ryot-app/contract` is one-way; the HTTP contract must not import this package.
- Share policy here only when both bridge peers must enforce it; keep runtime implementation policy with its runtime.
- Derive transport artifacts from canonical `PluginClientArtifact` metadata and file policy, not parallel representations.
