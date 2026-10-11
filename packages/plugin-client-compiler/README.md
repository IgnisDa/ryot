# Client Plugin Compiler

`ryot plugin build` uses this package to validate client sources and emit a reusable client module
artifact into the plugin archive. Server assembly builds the shared iframe runtime and kernel renderer
modules with the same compiler. The running server imports these artifacts and composes page documents
without invoking a compiler.

`compileClientPluginModule` and `buildClientRuntime` require `FileSystem` and `ViteBuildService`;
callers provide `pluginClientCompilerPlatformLayer` at their entrypoint.

Module input selects `kind: "plugin"` with a required canonical `packageId`, or `kind: "kernel"`
without an authored package identity. The result carries the same discriminator: plugin builds return
`PluginClientArtifact`; kernel renderer builds and `buildClientRuntime` return `ClientRuntimeArtifact`.
Plugin input also requires `clientDeclarationHash`, computed from the full canonical manifest client
declaration. Module artifacts record the scoped package/export targets encountered during import
resolution, not every declared dependency alias. Kernel modules share this import metadata; the root
runtime has no plugin imports. Embedded composition metadata remains separate.

## Source And Import Policy

Validated package-relative `client/**` and `shared/**` files are staged under the workspace source
namespace. Compiler-owned module and style entries are staged separately. Normal Vite and
TypeScript bundler resolution handles relative TypeScript imports, including extensionless imports
and `.js` specifiers that resolve to TypeScript sources.

Author imports are checked before Vite runs, including type-only imports. The data-only dependency
registry in `src/dependencies.ts` is the authority for trusted and neutral module membership and
TypeScript entry resolution. Shared sources can use only neutral registry entries and relative
shared files. Plugin dependencies map importer-local aliases to `{ packageId, scope }`. Authored
`@ryot-app/plugins/<alias>/<export>` imports resolve at Vite's import boundary to
`@ryot-app/plugins/<scope>/<packageId>/<export>`, stay external, and resolve through the page import map. Dynamic
imports, Vite query and glob imports, escaping asset URLs, and authored Tailwind `@plugin`,
`@config`, and `@source` directives are rejected.

`@ryot-app/plugin-ui-sdk/markdown` is an exact trusted registry entry. Its Markdown and directive
dependencies are private implementation details; plugin sources cannot import them directly.

Motion is a private UI SDK dependency, included in the shared runtime. Plugin authors use the SDK's
motion primitives; direct `motion/react` imports are not in the dependency registry.

## Compilation Stages

Effect schemas in `src/input.ts` define package inputs and public exports. Their derived types are
the public compiler types.

`src/planning.ts` validates the package input. `src/compile.ts` checks source limits, UTF-8, import
and stylesheet policy, TypeScript semantics, and public export contracts without running Vite.
`src/module.ts` stages validated sources, runs one minified production Vite module build, checks
emitted files and references, and finalizes the artifact. Validation and stylesheet generation are
isolated in `src/generated-source.ts`.
Combined client/shared source and raw asset input is limited to 1 MiB; individual raw assets remain
limited to 256 KiB. Emitted artifacts have a separate 8 MiB limit.

## Vite Module

The compiler builds an ES2022 ESM module with a relative base, production React JSX, and minified
JavaScript and CSS, with source maps disabled. Trusted packages and declared plugin dependencies remain external, resolved
through the composed document's import map. Vite resolves plugin-local imports and assets.

The official `@tailwindcss/vite` plugin processes a compiler-owned stylesheet. Automatic scanning is
disabled with `source(none)`, and explicit `@source` entries cover plugin TypeScript and
both client SDK source roots. The Tailwind and SDK themes are imported by reference, so `module.css`
holds only utilities and authored CSS. Vite owns nested and multiple authored CSS imports, ordering,
URL rewriting, deduplication, and assets.
Emitted JavaScript references are inspected with the shared Rolldown parser. Emitted CSS imports
and declaration URLs are inspected with PostCSS and its value parser; comments and string content
are not treated as references. The client compiler rejects nonliteral dynamic imports in plugin
modules. The runtime's generated bootstrap entry only calls the SDK's `./bootstrap` composition
bootstrap, which plugin source cannot import.
Both output validators share URL classification and query/fragment stripping. Plugin modules allow
declared dependencies and external URLs, but local references must name a root output file and must
not contain `..`. Runtime module imports reject external URLs except `data:` and resolve local paths
relative to the containing file, allowing nested traversal only within the artifact. Runtime asset
URLs can remain external; JavaScript imports must target JavaScript, and CSS imports cannot target it.

The shared runtime emits `runtime.css` with the fonts, the full Tailwind theme variables, preflight,
the SDK theme and palette, and document base rules. Every composition links it from the same public
artifact URL. Both stylesheets declare the same cascade layer order, so document link order does not
change precedence.

## Artifact Identity

The archived plugin artifact contains `module.js`, `module.css`, and emitted chunks and assets.
Approved SDK and React imports resolve to one shared image-built runtime through the composed page's
import map. Declared plugin imports resolve to the installed dependency's module. Routes and automatic
entity presentations are selected from the current authorized catalog when the page is composed;
database IDs are not embedded in the plugin module.

Vite may also emit `chunk-[hash].js` and `asset-[hash][extname]` files. Multiple and nested authored
CSS imports are resolved into `module.css`; Vite owns asset URLs. Every emitted path, MIME type,
local reference, file count, per-asset size, and total size is validated. The hash covers every
output byte and content type plus the name, package or kernel identity, and compiler/protocol identity. Final files are
sorted by name. Compiler version 1 identifies minified module artifacts.
Hashes also cover the canonically sorted import targets and, for authored plugins, the client
declaration hash. Archives require that declaration hash to match the manifest.
The pure executable-text codec in `@ryot-app/ts-utils/executable-text` retains valid UTF-8 bytes,
including a leading BOM, and rejects strings that would require replacement during encoding. Artifact
hashing uses those bytes. The artifact identity implementation is owned by
`@ryot-app/plugin-client-contract`.

Installing an archive trusts its compiled client executable bytes. The server checks archive
structure, executable UTF-8, hashes, limits, MIME types, and manifest consistency; it does not prove compilation
provenance. Image-owned artifact hashes are public, and other artifacts require capabilities.
Compositions reference these immutable modules; their HTML documents are dynamic and no-store.
