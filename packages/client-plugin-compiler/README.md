# Client Plugin Compiler

This package compiles archived plugin client sources into the immutable artifact loaded by a plugin
iframe. It is independent from `@ryot-app/sandbox-compiler`: only generic TypeScript infrastructure
is shared through `@ryot-app/typescript-compiler`.

## Source And Import Policy

Plugin client source is limited to the archive's `client/**` and `shared/**` roots. Relative imports
must remain within an allowed root. `shared/**` accepts environment-neutral `.ts` files and may use
only `@ryot-app/plugin-kit/{effect,ryotql,schema}` as bare imports, matching the sandbox compiler's
policy.

Client bare imports use a fixed trusted-module allowlist. Anything else fails compilation rather
than falling through to the host resolver. The exact list is maintained in `AGENTS.md` and
`src/dependencies.ts`.

The resolver must also provide concrete paths for transitive re-export barrels such as `effect` and
`lucide-react`. Declining these can emit a bundle with dangling references even though bundling
succeeds. Plain `effect` resolves to the narrow supported shim; its exports and pinned `effect/*`
resolver entries must stay synchronized.

## Styles

The compiler injects Tailwind's entry once, then emits plugin CSS and inlines
`@ryot-app/client-ui-sdk/theme.css` followed by `palette.css`. This gives every plugin Preflight,
shared accessibility rules, layer order, and concrete token values even when it has no stylesheet.
The compiler scans plugin sources and the UI SDK's TypeScript sources so SDK-only classes are emitted.

Palette values are baked into artifacts. A palette change therefore requires current artifacts to be
compiled; stale artifacts are not patched at runtime.

## Artifact Identity

The compiler embeds format, client API version, bridge version, compiler version, and content hash;
plugin source cannot declare or override them. `plugin.js`, `plugin.css`, and assets are hashed.
`index.html` is emitted last and excluded because it embeds that hash.

The bridge protocol and `CLIENT_COMPILER_VERSION` are currently exactly 1. Cached artifacts are
reused only when format, client API, bridge, and compiler metadata all match current constants.
Otherwise the source is compiled into a new immutable content-addressed artifact; there is no stale
fallback.
