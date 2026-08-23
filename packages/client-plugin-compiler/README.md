# Client Plugin Compiler

This package compiles archived plugin client sources into the immutable application artifact loaded
by a plugin iframe. It uses `@ryot-app/vite-compiler` for scoped workspaces and Vite invocation and
keeps client policy and artifact orchestration in this package.

## Source And Import Policy

Validated archive-relative `client/**` and `shared/**` files are staged under the workspace source
namespace. Compiler-owned HTML, bootstrap, and style entries are staged separately. Normal Vite and
TypeScript bundler resolution handles relative TypeScript imports, including extensionless imports
and `.js` specifiers that resolve to TypeScript sources.

Author imports are checked before Vite runs, including type-only imports. The data-only dependency
registry in `src/dependencies.ts` is the authority for trusted and neutral module membership and
TypeScript entry resolution. Shared sources can use only neutral registry entries and relative
shared files. Contributor public imports resolve only through the authorized export map. Dynamic
imports, Vite query and glob imports, escaping asset URLs, and archive Tailwind `@plugin`,
`@config`, and `@source` directives are rejected.

## Compilation Stages

Effect schemas in `src/input.ts` define both package and contributor-graph inputs, exports, routes,
and automatic registrations. Their derived types are the public compiler types. Worker schemas
reuse the same structures and transform canonical Base64 directly to bytes; artifact Base64 uses
the transform owned by `@ryot-app/client-plugin-contract`.

`src/planning.ts` normalizes either input into one validated `ClientCompilationPlan`. Execution then
decodes and checks source policy and limits, performs semantic analysis, stages a workspace, invokes
Vite, validates output, and finalizes the artifact. Compiler-owned bootstrap, validation, HTML, and
stylesheet generation is isolated in `src/generated-source.ts`.

## Vite Application

The compiler performs a normal Vite application build with a generated HTML entry and bootstrap,
relative base, production React JSX, and an ES2022 browser target. Trusted packages resolve through
their public exports. The build has no Bun resolver, virtual source loader, package-specific
bundler repair, CSS-empty hook, manual font parser, stylesheet graph, asset copier, or JavaScript
rewrite.

The official `@tailwindcss/vite` plugin processes a compiler-owned stylesheet. Automatic scanning is
disabled with `source(none)`, and explicit `@source` entries cover reachable plugin TypeScript and
both client SDK source roots. Fonts, theme, palette, and base rules are ordinary CSS imports. Vite
owns nested and multiple authored CSS imports, ordering, URL rewriting, deduplication, and assets.

## Artifact Identity

The artifact contains Vite's complete emitted HTML, JavaScript, CSS, font, image, and other allowed
asset set. The configured entry and stylesheet names are `plugin.js` and `plugin.css`; Vite may also
emit `chunk-[hash].js` and `asset-[hash][extname]` files. Multiple and nested authored CSS imports
are resolved by Vite into the application stylesheet, and Vite owns the resulting asset URLs.
Every emitted path, MIME type, local reference, file count, per-asset size, and total size is
validated. `index.html` remains the stable served entry.

The hash covers every non-HTML output byte and content type plus the plugin name and protocol
identity. Vite emits HTML with a compiler placeholder; the compiler computes metadata from the
other outputs and variable title input, then replaces that placeholder. This avoids hashing a
document that embeds its own hash. All final files, including `index.html`, are sorted by name. The
current compiler identity is 1; artifact format, client API, and bridge protocol remain version 1.
