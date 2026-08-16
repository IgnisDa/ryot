# Plugin Bundle Format And CLI

**Parent Plan:** [Kernel Assembly](./README.md)

**Status:** pending

## What to build

Define the plugin bundle and the tool that produces it, following the parent plan's Plugin Bundle Format and Plugin CLI decisions. Nothing consumes bundles yet; this task makes them exist and be correct.

A bundle is a directory named by the plugin slug containing a canonical `manifest.json` and a `backend/` tree of sandbox sources. The manifest is the same value the authenticated install endpoint already accepts, encoded as JSON and decodable by the contract's canonical manifest schema. Script entries are bundle-relative paths under `backend/`, which matches how the kernel's existing source loader keys files, so compilation needs no change. A `client/` subdirectory is reserved and absent. Test files are excluded. The bundle carries no separate content hash, because package identity remains the existing source hash derived from the manifest and file map.

Create `@ryot/cli` exposing a `ryot` binary with exactly one command, `plugin build`. It loads a plugin package's manifest entry, decodes it through the canonical manifest schema, and fails with the decode error when invalid, so manifest validity becomes a build-time guarantee rather than a boot-time one. It collects the package's backend sources, writes the bundle, and supports an explicit output directory and a watch mode. Its default output is the plugin package's `dist/bundle`.

Wire the command as each plugin package's build script so ordinary build ordering produces bundles for any consumer that later needs them. Do not add further subcommands, and do not move configuration reference generation into this package.

## Acceptance criteria

- [ ] A built bundle contains a `manifest.json` that decodes through the canonical plugin manifest schema without modification.
- [ ] Every script entry declared in a built manifest resolves to a file present under the bundle's `backend/` tree.
- [ ] Test files are absent from built bundles, and no `client/` directory is emitted.
- [ ] `plugin build` fails with the decoding error when a manifest is invalid, before writing any output.
- [ ] `plugin build` supports an explicit output directory and a watch mode, and defaults to the plugin package's `dist/bundle`.
- [ ] Both shipped plugins build bundles through their package build script.
- [ ] `@ryot/cli` exposes no command other than `plugin build`.
- [ ] Repository check and test tasks pass.
