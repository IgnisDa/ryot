# Client Plugin Compiler

Compiles a plugin's archived client sources into the artifact a plugin document loads. It is a
separate engine from `@ryot-app/sandbox-compiler`: the two may share generic TypeScript
infrastructure through `@ryot-app/typescript-compiler` and the server-owned process-supervision
boundary, but not import policies, limits, protocols, output models, or public APIs. There is no
shared compiler mode, bridge, or fallback.

## Import Policy

The trusted module allowlist is fixed. Any other bare import fails compilation rather than passing
through, so a plugin cannot reach a module the artifact does not carry.

## Stylesheet Composition

The Tailwind entry is injected into the generated stylesheet rather than left to the plugin to
`@import`. A plugin may ship no stylesheet at all, and without the entry that document gets neither
Preflight nor a registered `@layer` order — the accessibility base layer inlined from
`@ryot-app/client-ui-sdk/theme.css` would land in an unregistered layer that any author rule
outranks. Serving the entry once keeps a plugin that also imports it a no-op.

Plugin documents inherit their cursor and focus-visible base rules from that inlined `theme.css`,
which is why `clientBaseStylesheet` must not redefine them.

`@ryot-app/client-ui-sdk/palette.css` is inlined after `theme.css` so a plugin document carries real
token values instead of receiving them over the bridge. It is unlayered, so it outranks the layered
base rules, and the plugin's own stylesheet is emitted before it. Palette values are therefore baked
into an artifact: changing one means bumping `CLIENT_COMPILER_VERSION` so installed plugins are
recompiled.

Tailwind scans this package's own `.ts`/`.tsx` sources as well as `@ryot-app/client-ui-sdk`, so a
class that only ever appears in SDK source still reaches a plugin's stylesheet.

## Artifact Identity

`index.html` is emitted last and excluded from the artifact hash it carries; the hash covers
`plugin.js`, `plugin.css`, and assets only. Format, versions, and hash are embedded by the compiler
and can never be declared or overridden by plugin source.
