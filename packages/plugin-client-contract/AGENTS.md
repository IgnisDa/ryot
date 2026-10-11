# Client Plugin Contract

- Own the client plugin bridge protocol, artifact model, source file policy, and shared client capability payloads here.
- Keep the dependency on `@ryot-app/contract` one-way. The HTTP contract must never import this package.
- Keep runtime implementation policy in the owning runtime unless both bridge peers must enforce it.
- Derive transport artifact representations from `PluginClientArtifact` metadata and file policy; transform canonical Base64 to `Uint8Array` at the schema boundary.
