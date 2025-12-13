# Approved Runtime Dependencies

**Parent Plan:** [TypeScript Sandbox SDK and Compilation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Implement the exact dependency and offline loading model from the Dependency Policy section after the core compiler exists. Pin Zod `4.4.3`, Day.js `1.11.21`, Cheerio `1.2.0`, and youtubei.js `17.2.0`; expose only explicit SDK entry points; build versioned local runtime modules; and configure Deno import-map resolution under cached-only, no-remote execution.

The compiler must accept approved SDK imports, map them to local runtime modules, and reject direct package, npm, Deno npm, Node, Bun, URL, and computed dynamic imports. Keep the small SDK definition runtime bundled into each script while externalizing the approved dependency modules so large packages are not duplicated in every stored script. Prove module resolution and representative API typing without testing third-party library behavior or making live network calls.

## Acceptance criteria

- [x] All four approved packages are pinned to the exact versions required by the parent plan
- [x] The SDK exposes explicit supported entry points for Zod, Day.js including custom parse format, Cheerio, and youtubei.js
- [x] Approved dependency modules are built ahead of execution and available through a Deno import map in a read-only runtime directory
- [x] Deno loads each approved dependency with remote access disabled and without contacting a registry
- [x] Compiled script modules do not duplicate large dependency implementations
- [x] User compilation rejects direct package, npm, Deno npm, URL, Node, Bun, and computed dynamic imports
- [x] SDK type fixtures prove approved imports have the pinned package types
- [x] Deno load tests cover one compiled fixture per approved SDK dependency without asserting library-owned behavior
- [x] youtubei.js compilation and loading work with its pinned release without live requests
- [x] Backend startup and package-cache behavior no longer depend on floating unversioned package specifiers
- [x] Check, tests, and build pass

## Implementation notes

- `@ryot/sandbox-sdk` now pins Zod `4.4.3`, Day.js `1.11.21`, Cheerio `1.2.0`, and youtubei.js `17.2.0` and exposes only explicit `/zod`, `/dayjs`, `/dayjs/custom-parse-format`, `/cheerio`, and `/youtubei` dependency paths. Day.js installs `customParseFormat`; Cheerio exposes parsing operations without its network loaders. Zod is consumed as a namespace from `/zod`; the redundant SDK-root `z` export was removed.
- The backend builds self-contained ESM modules into a staging directory, then publishes an immutable, content-addressed, read-only runtime directory. Exact directory contents and length-framed hashes are verified before reuse, concurrent publishers revalidate and reuse the same atomic winner, and deterministic repairs are reused if a primary directory is corrupt. Deno receives a separate content-addressed cache with no registry packages.
- The compiler resolves only the SDK root and approved dependency paths for type checking. The small SDK definition runtime remains bundled, while approved dependencies remain external imports resolved by Deno's local import map. Direct package, `npm:`, Deno npm, URL, Node, Bun, relative, test-only SDK, CommonJS, dynamic, generated-module, and worker imports are rejected before resolution.
- Temporary format-0 compilation rewrites existing approved `npm:` dependency strings to public SDK paths. The runtime maps `/youtubei` to youtubei.js's Deno/server platform so legacy providers retain server request semantics; the explicit Day.js plugin path preserves custom-parse-format imports.
- Deno runs with `--cached-only`, `--no-npm`, `--no-remote`, `--no-config`, and `--no-lock`. Format-1 execution additionally removes `eval`, string function constructors, and workers before importing user code. Deno permissions remain the security boundary for all compiled modules.
- Docker installs the sandbox SDK's complete hoisted production dependency closure from the committed lockfile, then builds the runtime in the image without registry access. Isolated Docker smokes verified both runtime generation and TypeScript resolution for every public dependency path from the packaged `node_modules` graph.
- Type fixtures cover representative pinned APIs. Compiler tests pin externalization and import rejection. Deno tests compile and load one fixture per dependency against an empty cache without live requests; format-0, intrinsic-hardening, corruption-repair, extra-file, and concurrent-publication tests cover the compatibility and security paths.

### Problems encountered

- Bun emitted invalid ESM when the Day.js and Cheerio SDK wrappers directly re-exported imported values. Binding those package values locally before exporting them produced valid standalone modules without changing the supported API.
- Keeping `z` as a named SDK-root re-export duplicated the new explicit dependency surface and exposed inconsistent behavior through Vitest's transform. Removing it and consistently using `import * as z from "@ryot/sandbox-sdk/zod"` resolved the duplication and kept one approved Zod module identity.
- The first Docker layout copied direct SDK packages without their Bun-isolated transitive graph. A lockfile-filtered hoisted production install now packages the complete closure, and isolated runtime/compiler smokes verify it.
- Adversarial review exposed generated import, stale-cache, concurrent publication, extra-file, and legacy youtubei platform risks. Runtime flags and intrinsic hardening close generated imports; content hashing and immutable atomic publication close integrity races; the Deno/server youtubei build preserves legacy semantics.
- A full-suite run exposed a check-before-fallback publication race: a lagging builder could see the primary appear after its first validation and select a repair path without revalidating the winner. Revalidating existing primary and deterministic-repair paths immediately before fallback makes concurrent builders converge on the same atomic publication.
- Final adversarial review found that unframed filename and file-content hashing allowed coordinated adjacent-file edits to preserve the hashed byte stream. Length-framing every hash record closes that integrity gap, and a two-file boundary-shift regression test proves corruption triggers repair.
- The backend Docker builder target and isolated packaged-runtime/compiler smokes pass. A full final-image build remains blocked by unrelated app-client Expo TypeScript failures, and a later no-cache builder retry exhausted local Docker storage.

### Deviations

- Cheerio's SDK entry exposes `load`, `contains`, and `merge` rather than its Node-oriented stream and URL loaders. Sandbox network access must remain host-mediated, and current providers only require document parsing, so exposing network loaders would contradict the capability model.
- A dedicated public `/dayjs/custom-parse-format` path was added instead of hiding the plugin behind an internal runtime alias. This keeps format-0 rewrites and future TypeScript modules on the same explicit, type-checked SDK surface.

## User stories addressed

- User story 11
- User story 27
- User story 39
