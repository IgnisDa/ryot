# Plugin Bundle Format And CLI

**Parent Plan:** [Kernel Assembly](./README.md)

**Status:** done

## What to build

Define the plugin bundle and the tool that produces it, following the parent plan's Plugin Bundle Format and Plugin CLI decisions. Nothing consumes bundles yet; this task makes them exist and be correct.

A bundle is a directory named by the plugin slug containing a canonical `manifest.json` and a `backend/` tree of sandbox sources. The manifest is the same value the authenticated install endpoint already accepts, encoded as JSON and decodable by the contract's canonical manifest schema. Script entries are bundle-relative paths under `backend/`, which matches how the kernel's existing source loader keys files, so compilation needs no change. A `client/` subdirectory is reserved and absent. Test files are excluded. The bundle carries no separate content hash, because package identity remains the existing source hash derived from the manifest and file map.

Create `@ryot/cli` exposing a `ryot` binary with exactly one command, `plugin build`. It loads a plugin package's manifest entry, decodes it through the canonical manifest schema, and fails with the decode error when invalid, so manifest validity becomes a build-time guarantee rather than a boot-time one. It collects the package's backend sources, writes the bundle, and supports an explicit output directory and a watch mode. Its default output is the plugin package's `dist/bundle`.

Wire the command as each plugin package's build script so ordinary build ordering produces bundles for any consumer that later needs them. Do not add further subcommands, and do not move configuration reference generation into this package.

## Acceptance criteria

- [x] A built bundle contains a `manifest.json` that decodes through the canonical plugin manifest schema without modification.
- [x] Every script entry declared in a built manifest resolves to a file present under the bundle's `backend/` tree.
- [x] Test files are absent from built bundles, and no `client/` directory is emitted.
- [x] `plugin build` fails with the decoding error when a manifest is invalid, before writing any output.
- [x] `plugin build` supports an explicit output directory and a watch mode, and defaults to the plugin package's `dist/bundle`.
- [x] Both shipped plugins build bundles through their package build script.
- [x] `@ryot/cli` exposes no command other than `plugin build`.
- [x] Repository check and test tasks pass.

## Implementation Notes

- `packages/cli` is `@ryot/cli` and exposes the `ryot` binary directly from its Bun TypeScript entry point. The command tree uses Effect's `Command` and `Flag` APIs from `effect/unstable/cli`, with `BunServices.layer` and `BunRuntime.runMain` providing the platform services. No separate command-line parser or watcher dependency was added.
- `plugin build` treats the working directory as the plugin package root and resolves the manifest authoring entry from `package.json`'s `exports["."].default`. It decodes the default export through the canonical `PluginManifest` schema before touching the output directory, so an invalid manifest preserves any previous bundle and reports the schema decoding error.
- Bundle production scans `backend/**/*.ts` through `Bun.Glob`, excludes `*.test.ts`, and uses Effect filesystem and path services for reads and writes. Every declared script entry must remain under `backend/` and match a collected file before output replacement. The emitted directory contains only canonical `manifest.json` and the filtered `backend/` tree; it has no `client/`, content hash, or additional metadata.
- Watch mode fingerprints package TypeScript authoring inputs and `package.json` while excluding dependencies and generated output. A changed fingerprint runs a fresh non-watch child process through Effect's child-process service, so manifest imports cannot remain stale. Initial failure exits, while later failures are reported and retried with a two-second backoff.
- Both `@ryot/media-plugin` and `@ryot/fitness-plugin` declare `@ryot/cli` as a development dependency and use `ryot plugin build` as their package build script. Their default bundles are written to `dist/bundle`.
- Focused `@effect/vitest` tests use scoped Effect filesystem, path, and child-process primitives to cover canonical decoding, default and explicit output paths, declared script presence, test and client exclusion, validation before output mutation, command rejection, and watch rebuilding. The real media and fitness bundles also build successfully: all 182 media script entries and all 9 fitness script entries resolve, with no test files or `client/` directories emitted.
- `bun turbo --filter=@ryot/cli --filter=@ryot/media-plugin --filter=@ryot/fitness-plugin check` and the matching filtered `test` command pass. No end-to-end files run because this task only produces bundles; runtime bundle discovery begins in Task 03, so no end-to-end suite is affected yet.
