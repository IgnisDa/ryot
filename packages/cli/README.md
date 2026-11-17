# Ryot CLI

Run commands from the plugin package root.

`ryot plugin build` first runs the message step below, then validates the manifest and compiles
backend and client sources. It then validates the plugin's definitions, declared queries, saved views, and controls with the ingestion validator
against the kernel baseline and the declared dependency closure. Each dependency resolves to an
installed npm dependency of the importing package whose `exports["."].default` is a plugin manifest.
The build fails when a declared dependency is not installed. The build writes a deterministic source-free archive to `dist/<publisher>/<name>.zip`. Use `--output <path>` for an explicit filename or `--watch` to rebuild after source changes.

Manifest `dependencies` map importer-local aliases to `{ packageId, scope }`. Authored imports use `@ryot-app/plugins/<alias>/<export>`. Compilation replaces the alias with the exact scoped package target; it does not install dependencies or select revisions.

Client artifacts record the imported package/export targets and a hash of the full client declaration. Archive validation rejects an artifact whose declaration hash differs from the manifest, even when its package ID and executable bytes are unchanged. These checks establish representation consistency, not compiler provenance or publisher authenticity.

## Messages

`ryot plugin messages` validates `shared/messages/<locale>.json` with the shared catalog validator
from `@ryot-app/i18n` (the same rules and limits as kernel catalogs; `en` is required) and scans the
plugin's non-test `.ts`/`.tsx` sources under `backend/`, `client/`, `manifest/`, `shared/` and the
package root. Any quoted literal equal to a key counts as a use; a `catalogMessage(...)` or
`catalogRowText(...)` call whose first literal is not a key, and a key that nothing references, both fail. It then writes the typed
`catalogMessage` builder, and `catalogRowText` for row text, to `shared/messages.generated.ts`,
rewriting it only when its contents change.
Generated modules are not committed; run this step before type-checking plugin sources.
`ryot plugin build` leaves the module out of the compiler sources and passes the compiled English
catalog to both compilers, which generate the builder themselves (see
[Messages](../plugin-kit/README.md#messages)).

`ryot plugin build` additionally requires every manifest display text, including property schema
labels, hints and choice labels and the search options schemas of compiled provider scripts, to
name an English key whose arguments are exactly the declared ones (none, except row text bindings), and writes the compiled catalogs, plus the generated `en-XA` pseudo-locale, into the
archive. Watch mode also rebuilds after catalog changes.
