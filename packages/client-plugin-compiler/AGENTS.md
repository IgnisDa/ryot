# Client Plugin Compiler

Rationale for these rules lives in `README.md`.

- Keep import policy, limits, protocol, output model, and public API independent from `@ryot-app/sandbox-compiler`. Shared generic TypeScript infrastructure belongs in `@ryot-app/typescript-compiler`.
- Keep the trusted module allowlist fixed: `clsx`, `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, the published `@ryot-app/client-sdk` entry points, the `@ryot-app/client-ui-sdk` entry points including `/icon`, `/table`, `/schema-form`, and `/tint`, and the environment-neutral `@ryot-app/plugin-kit/{effect,ryotql,schema}` entry points. Any other bare import must fail compilation, never silently pass through. Every allowlist entry is deliberate — widen it only by naming the new entry point here, never implicitly.
- Resolve a re-export barrel a trusted module pulls in — `effect`, `lucide-react` — to a concrete path here. Declining it in the bare-specifier resolver makes Bun drop the barrel's re-exported bodies and emit a bundle whose references dangle, which only surfaces when the artifact is evaluated. A trusted subpath that reaches a new barrel needs the same treatment and a test that runs the emitted `plugin.js`. Keep the `effect` shim's export list and the resolver's pinned `effect/*` submodule list in sync — adding a namespace to one without the other resolves it from the wrong root.
- Restrict a `shared/**` file's bare imports to `@ryot-app/plugin-kit/{effect,ryotql,schema}` only, and reject a relative import that would escape `shared/`. `@ryot-app/sandbox-compiler` resolves the same three plugin-kit files, so this engine's shared-source policy must not drift from it.
- Inject the Tailwind entry into the generated stylesheet rather than relying on a plugin to `@import` it, and serve it once so a plugin that also imports it is a no-op.
- Leave cursor and focus-visible base rules to the inlined `theme.css`; `clientBaseStylesheet` must not redefine them.
- Inline `@ryot-app/client-ui-sdk/palette.css` after `theme.css`, and emit the plugin's own stylesheet before it. Keep `CLIENT_COMPILER_VERSION` exactly 1 unless an explicit future change coordinates the full marker boundary.
- Emit `index.html` last and exclude it from the artifact hash it carries; the hash covers `plugin.js`, `plugin.css`, and assets only.
- Embed artifact identity (format, versions, hash) in the compiler; never let plugin source declare or override it.
- Reuse a cached client artifact only when its format, client API, bridge protocol, and compiler metadata match the current constants. Do not add alternate metadata acceptance or stale-artifact fallbacks.
