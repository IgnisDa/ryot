# Client Plugin Compiler

`ryot plugin build` uses this package to validate client sources and emit a reusable client module
artifact into the plugin archive. Server assembly builds the shared iframe runtime and kernel renderer
modules with the same compiler. The running server imports these artifacts and composes page documents
without invoking a compiler. User-authored pages compile on demand in a supervised subprocess.

`compileClientPluginModule` and `buildClientRuntime` require `FileSystem`, `ViteBuildService`, and
`TypeScriptSession`; callers provide `pluginClientCompilerPlatformLayer` at their entrypoint, so every
compile in that scope shares one TypeScript server. `pluginClientCompilerEnvironmentLayer` also type
checks the SDKs and other resolved dependencies to verify the compiler environment.

Module input selects `kind: "plugin"` with a required canonical `packageId`, or `kind: "kernel"`
without an authored package identity, or `kind: "page"` with a required `pageDeclarationHash`.
Plugin builds return `PluginClientArtifact`; kernel renderer builds and `buildClientRuntime` return
`ClientRuntimeArtifact`; page builds return `PageClientArtifact`. Page callers use
`pageDeclarationHash({ entry, pluginDependencies })` from the client contract,
and supply `publicExports: { page: { kind: "page", entry } }`. All three module kinds share source,
import, AST, semantic, stylesheet and output validation. Pages accept only `client/**` and `shared/**`
files; plugin package inputs may also contain unrelated backend and manifest files.
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

Script policy uses the authored TypeScript ASTs from the semantic project. It checks imports,
re-exports, import types, dynamic imports, globs, and static asset URLs without treating comments or
strings as code. The top-level `client/` or `shared/` region determines authority; nested directories
with those names do not change it. Compiler-generated declarations are not authored sources.

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

`analytics-section` exports are checked as `ComponentType<AnalyticsSectionProps>` through the public
client SDK contract. Their manifest registrations may name only same-owner analytics exports; those
declarations also participate in the existing client declaration hash.
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

## Server Worker

`./worker` is a long-lived `@ryot-app/compiler-worker` host. It compiles
`CLIENT_COMPILER_WARM_UP_INPUT` from `./warm-up` before it accepts jobs and then serves one JSON
request per line, so a page compile type checks only its own sources against already-loaded SDK and
React declarations.
`src/protocol.ts` owns Effect codecs for canonical base64 source and artifact bytes. Requests contain
`input`, `workspaceParentPath` and `workspaceJobId`; responses contain either
`{ success: true, value: { artifact } }` or `{ success: false, error }` with bounded compiler
diagnostics. The worker never executes authored code. Runtime compiles trust the SDKs and their
dependencies; under environment verification their type errors fail with
`RYOT_CLIENT_COMPILER_ENVIRONMENT` instead of being attributed to the authored source.
The source worker runs its exported `runClientCompilerWorker` entry when executed directly; the
packaged server worker imports and calls the same entry.

`./supervisor` exports `makeClientCompilerSupervisor`, which runs the worker in a supervised pool. Its
`compile` accepts the page variant of `PluginClientCompilerPackageInput` and returns
`Effect<PageClientArtifact, PluginClientCompilerFailure | CompilerWorkerUnavailable>`. Timeouts,
memory overruns, and oversized responses fail the job with `RYOT_CLIENT_COMPILER_TIMEOUT`,
`RYOT_CLIENT_COMPILER_MEMORY`, or `RYOT_CLIENT_COMPILER_PROCESS` diagnostics; a worker that cannot
start, exits, returns an invalid result, or loses memory supervision fails with
`CompilerWorkerUnavailable`. Job workspaces stay beneath the compiler package so ordinary package
resolution finds its declared dependencies in both source and packaged layouts, and the pool removes
each one after its job. Limits are two concurrent workers, a 30-second job timeout, a 60-second
warm-up timeout, a 5-minute idle timeout, 1 GiB sampled Linux process-tree memory with recycling above
768 MiB, and a 384 MiB `GOMEMLIMIT` for the native TypeScript server.

`kernel/backend/src/modules/pages/compiler.ts` owns `ClientPluginCompiler.layer`, which resolves the
source or packaged worker path for the supervisor. Page lifecycle code provides this Layer, reports
`CompilerWorkerUnavailable` as the `compiler-unavailable` authoring reason, and persists the returned
artifact; compilation itself has no database or publication effects.

Server builds emit `plugin-client-compiler-worker.js` and `smoke-compiler-workers.js` alongside the
server bundle. The runtime image retains compiler dependencies and runs the smoke script as its
runtime user during the image build. Run the smoke script with an optional worker path to exercise
another packaged layout. Its workers verify their environments, then it compiles TSX, SDK imports,
Tailwind, authored CSS and an SVG, and checks the emitted artifact references.

Page declaration identity includes only entry and portable scoped package references. Queries, page
IDs, installation IDs, ownership and write grants remain runtime metadata. Restoring a page can remap
those references while retaining its compiled artifact bytes and hash; no compiler is needed.

## Authoring Reference

`./sdk-reference` exports `generateClientSdkReference()`, an Effect requiring `FileSystem`. It
resolves only client/UI SDK entrypoints admitted by the compiler dependency registry and uses the
same TypeScript project settings and public export resolution as authored compilation. The output
contains sorted exports, signatures, component props, supported imports and SDK-owned
`assistant-reference.md` guidance/examples. It contains no timestamps or machine paths.
Server builds package this generated Markdown for the assistant; unbundled development generates
from current SDK sources. No generated API inventory is maintained in source control.
