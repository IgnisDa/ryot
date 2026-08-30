# Client Plugin Compiler

This package compiles archived plugin client sources into the immutable artifact loaded by a plugin
iframe. It is independent from `@ryot-app/sandbox-compiler`: only generic TypeScript infrastructure
is shared through `@ryot-app/typescript-compiler`.

## Source And Import Policy

Plugin client source is limited to the archive's `client/**` and `shared/**` roots. Relative imports
must remain within an allowed root. `shared/**` accepts environment-neutral `.ts` files and may use
only `@ryot-app/plugin-kit/{effect,ryotql,schema}` as bare imports, matching the sandbox compiler's
policy.

Only those roots are compiler inputs, so only they are charged against the source-byte limit; an
archive's `backend/**` sources are neither compiled, type-checked, nor counted. A plugin package
charges every eligible authored source it ships, while a composed application charges only the
sources its bundler and style graphs actually reach from the application entry.

Composed applications namespace each contributor as `contributors/<stable-id>/client/**` and
`contributors/<stable-id>/shared/**`. Public imports use
`@ryot-app/plugins/<plugin-slug>/<export-name>` and resolve only through the authorized map supplied
with the compiler input. The compiler does not discover plugins or private files by slug. The map and
automatic-presentation registrations are expected to use backend-resolved stable identities and
stable order; traversal is cycle-safe in the bundler module graph.

Client contributors use the public `@ryot-app/client-sdk` and `@ryot-app/client-ui-sdk` entry points.
Only `shared/**` uses the environment-neutral `@ryot-app/plugin-kit/{effect,ryotql,schema}` shims;
backend plugin source uses plugin-kit and sandbox SDK surfaces rather than client packages.

Client bare imports use a fixed trusted-module allowlist. Anything else fails compilation rather
than falling through to the host resolver. The exact list is maintained in `AGENTS.md` and
`src/dependencies.ts`.

Plugin package builds supply every advertised public export to the compiler. Generated entries import
and type-check those exports and compose the authorized contributor graph. Route applications build a
manifest-backed route/entity registry; saved views and workspace homes build the selected renderer.
The generated bootstrap owns the document's only React root. Authored source exports components or
presentation definitions and never mounts or bootstraps an application.

The resolver must also provide concrete paths for transitive re-export barrels such as `effect` and
`lucide-react`. Declining these can emit a bundle with dangling references even though bundling
succeeds. Plain `effect` resolves to the narrow supported shim; its exports and pinned `effect/*`
resolver entries must stay synchronized.

## Styles

The compiler injects Tailwind's entry once, then emits all reachable contributor CSS in stable
namespaced source order and inlines
`@ryot-app/client-ui-sdk/theme.css` followed by `palette.css`. This gives every plugin Preflight,
shared accessibility rules, layer order, and concrete token values even when it has no stylesheet.
The compiler scans reachable contributor client sources plus the UI SDK's and client SDK's
TypeScript sources, so utility classes written in either SDK reach every artifact.

Palette values are baked into artifacts. A palette change therefore requires current artifacts to be
compiled; stale artifacts are not patched at runtime.

## Artifact Identity

The compiler embeds format, client API version, bridge version, compiler version, and content hash;
plugin source cannot declare or override them. `plugin.js`, `plugin.css`, assets, and the plugin
name that titles the document are hashed. `index.html` is emitted last and excluded because it
embeds that hash, so a rename yields a new artifact instead of colliding with the stored one.

Cached artifacts are reused only when format, client API, bridge, and compiler metadata all match
current constants.
Otherwise the source is compiled into a new immutable content-addressed artifact; there is no stale
fallback.

The client artifact format, client API, compiler, and bridge protocol remain version 1. This is a
greenfield coordinated boundary, so the compiler has no old bootstrap, format, or protocol path.
