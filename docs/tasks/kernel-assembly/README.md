# Kernel Assembly

## Tasks

**Overall Progress:** 4 of 6 tasks completed

**Current Task:** [Task 05](./05-embedded-kernel-scripts-and-checks.md) (pending)

### Task List

| #   | Task                                                                                          | Status  |
| --- | --------------------------------------------------------------------------------------------- | ------- |
| 01  | [Workspace Restructure And Server Assembly](./01-workspace-restructure-and-server-assembly.md) | done    |
| 02  | [Plugin Bundle Format And CLI](./02-plugin-bundle-format-and-cli.md)                           | done    |
| 03  | [Filesystem Plugin Discovery](./03-filesystem-plugin-discovery.md)                             | done    |
| 04  | [Legacy Migration Extraction](./04-legacy-migration-extraction.md)                             | done    |
| 05  | [Embedded Kernel Scripts And Architecture Checks](./05-embedded-kernel-scripts-and-checks.md)  | pending |
| 06  | [Image Assembly And Documentation](./06-image-assembly-and-documentation.md)                   | pending |

## Problem Statement

The application backend is the Ryot kernel. It is meant to be domain-agnostic: it owns plugins, installations, entities, events, relationships, saved views, definitions, sandbox execution, durable work, and transport, while media and fitness concepts belong to plugins. A term-scanning purity check enforces that the kernel source contains no domain vocabulary, and the kernel source currently passes it.

Textual purity is not structural separation. The kernel remains coupled to the shipped plugins in ways a term scanner cannot see.

`apps/app-backend/package.json` declares `@ryot/media-plugin` and `@ryot/fitness-plugin` as workspace dependencies, so both plugins are part of the kernel build graph and `turbo prune @ryot/app-backend` pulls them in. `src/modules/plugins/boot-sources.ts` statically imports both manifests and locates their source through relative path arithmetic against the repository layout. `src/main.ts` imports that module to write a plugin-aware configuration reference into the documentation site as a side effect of development startup. The purity checker itself imports both plugin packages to derive the vocabulary it forbids, so the guarantee is defined in terms of the very dependency it is meant to prevent.

Legacy bootstrap is the largest instance of the same problem. It is a Rust V10 to TypeScript adoption path of roughly six thousand seven hundred lines of media and fitness field mappings living inside the kernel's module tree, and `src/lib/infrastructure/db/migrate.ts` imports it directly, so kernel infrastructure depends on a domain module. It is also the only permanent wildcard in the purity allowlist.

The Dockerfile compounds this. It copies the repository `plugins` directory and the kernel sandbox scripts into absolute root paths that exist only to satisfy `import.meta.url` arithmetic performed from the bundled `dist/main.js`. The image therefore encodes the source layout of the repository rather than a deliberate runtime layout, and the set of shipped plugins cannot be changed without editing kernel code.

Meanwhile the plugin system already knows how to accept a plugin as data. The authenticated install endpoint receives a manifest and a source file map, decodes the manifest with the canonical contract schema, compiles it, and installs it. Only the first-party plugins arrive as compile-time imports. That asymmetry is the root cause, and removing it requires no new concepts.

An accepted client plugin architecture is planned but not implemented. It assumes each plugin owns an independently compiled client application alongside its backend code, compiled server-side against a bounded module universe, and hosted by a domain-agnostic client kernel. Nothing in the current repository layout provides a place for that work to land.

## Solution

Make a plugin a build artifact rather than a workspace import, and make image assembly the only place that knows which plugins ship.

Each plugin package builds into a bundle: a canonical `manifest.json` plus its backend sandbox sources, in the exact shape the existing trusted ingestion path consumes. A new `@ryot/cli` package produces it through a single `plugin build` command that first-party and third-party authors both use. Bundles are directories; a `client/` subdirectory is reserved for the client plugin work and stays empty for now.

The kernel discovers system plugins by reading a configured directory of bundles at boot. `boot-sources.ts` is deleted, the kernel drops both plugin dependencies, and the set of configured system slugs becomes runtime state derived from what was discovered. The kernel no longer has compile-time knowledge of any plugin, which makes the term-scanning purity checker unnecessary; it is deleted along with its allowlist, while the two generic architecture checks it also ran are preserved.

A new `apps/server` package becomes the composition root and the only workspace that knows media and fitness exist. The kernel exports its layer stages; the server sequences them and splices in legacy migration. Because the kernel cannot reference the assembly, the boundary is mechanical rather than conventional.

Legacy bootstrap moves to `migrations/v10-rust` as a package that depends on the kernel instead of living inside it. It still runs automatically during startup when Rust V10 tables are present, so the published upgrade runbook of pinning the last old minor, taking a backup, and changing the image tag is unchanged. There is no separate migration image.

Every filesystem path the server needs becomes a configuration field whose default is relative to the working directory. Because the image working directory is `/home/ryot`, every production path is byte-identical to today, and the same defaults are correct in development because `apps/server` reproduces the image layout inside its own package directory through an `assemble` task. Development requires no path environment variables and the checked-in developer environment file loses all of them.

The final Dockerfile copies the kernel bundle, the client bundle, and one directory per shipped plugin. Adding or removing a plugin is a copy line. The contents of that directory are system-scoped and trusted exactly as the rest of the image is.

Please note that this is a greenfield project with no production user data, so breaking changes and bigger refactors are fine. No bridge or compatibility code should remain, and documentation is to be updated.

## User Stories

1. As a Ryot developer, I want the kernel to have no build dependency on any plugin, so that domain code cannot leak into kernel modules through ordinary imports.
2. As a Ryot developer, I want a plugin's shipped form to be the same artifact a third-party author produces, so that first-party plugins dogfood the supported authoring path.
3. As a Ryot developer, I want plugin manifests validated when the plugin is built, so that a malformed manifest fails a build instead of a server boot.
4. As a Ryot developer, I want the set of shipped plugins expressed in the image definition, so that changing what ships does not require editing kernel code.
5. As a Ryot developer, I want the kernel test suite to run without any plugin package, so that kernel coverage cannot silently depend on domain fixtures.
6. As a plugin author, I want proving that my scripts compile and load in the sandbox to be my package's responsibility, so that the same guarantee is available to third-party plugins.
7. As a Ryot developer, I want legacy Rust migration code outside the kernel, so that a one-time adoption path is not part of the permanent runtime surface.
8. As a Ryot developer, I want the composition root to be the only place that knows which plugins and migrations exist, so that assembly decisions are visible in one file.
9. As a Ryot developer, I want the term-scanning purity checker and its allowlist removed, so that a structural guarantee is not restated as a fragile textual one.
10. As a Ryot developer, I want cycle detection and duplicate-layer detection preserved, so that deleting the purity checker does not lose unrelated architecture invariants.
11. As a Ryot developer, I want a working development server after cloning without configuring filesystem paths, so that environment setup is limited to genuinely per-developer values.
12. As a Ryot developer, I want editing a plugin's sandbox script to be picked up by the development loop, so that plugin work does not require manual restarts.
13. As a Ryot developer, I want the end-to-end suite to run against the same plugin discovery path as production, so that tests cannot pass through a development-only loading mode.
14. As an operator, I want to upgrade from Rust V10 by changing the image tag, so that the documented migration runbook continues to work unchanged.
15. As an operator, I want the shipped image to contain no absolute paths derived from the repository source layout, so that the runtime layout is deliberate and inspectable.
16. As an operator, I want the configuration reference to document every shipped plugin's variables, so that adding a plugin to the image documents it automatically.
17. As a Ryot developer, I want the client kernel and each plugin's client application to have a defined location before that work starts, so that the accepted client plugin architecture lands without another restructure.

## Implementation Decisions

### Workspace Layout

- The kernel moves to `kernel/backend` as `@ryot/kernel-backend` and `kernel/client` as `@ryot/kernel-client`. The workspace globs gain `kernel/*` and `migrations/*`.
- `kernel/client` is aspirational for now. It keeps its hard dependency on `@ryot/media-plugin/query-recipes`, which is addressed when the client plugin architecture is implemented.
- `apps/server` is a new `@ryot/server` package holding the composition root, the development supervisor, and the development assembly. It is the only workspace that depends on the plugin packages and on the legacy migration package.
- `migrations/v10-rust` is a new `@ryot/v10-rust-migration` package. Further one-time migrations, if any, become siblings.
- The Rust V10 backend and the V1 web frontend stay where they are. No top-level quarantine directory is introduced.
- Each plugin package gains a `backend/` subdirectory holding everything the server consumes, a reserved `client/` subdirectory, and a `shared/` subdirectory for code used by both halves. The manifest authoring entry stays at the package root.
- `@ryot/plugin-testing`, `@ryot/query-engine`, and `@ryot/test-fixtures` have no importers and are deleted. `@ryot/assets` is retained because it is consumed indirectly through its published GitHub URLs.
- `@ryot/sandbox-compiler` stays a standalone package. It runs as a separate worker process, resolves TypeScript and a native compiler binary from its own dependency closure, is installed by an isolated image stage, and gains rather than loses consumers.

### Kernel Package Boundary

- `@ryot/kernel-backend` declares `"exports": { "./*": "./src/*.ts" }`. Dependents import defining modules directly, matching the existing prohibition on barrel re-exports. Internal `#*` path imports are unchanged.
- The kernel package has no runnable entry point after Task 04. `apps/server` owns the entry point, the build output, and the process commands.
- The kernel must not depend on any plugin package, on `@ryot/v10-rust-migration`, or on `@ryot/server`, in production or development dependencies.

### Plugin Bundle Format

- A bundle is a directory named by the plugin slug containing `manifest.json` and a `backend/` tree of sandbox sources.
- `manifest.json` is the canonical manifest encoded as JSON and decodable by the contract's `PluginManifest` schema. It is the same value the authenticated install endpoint accepts today.
- Script entries in the manifest are bundle-relative paths under `backend/`. The kernel's existing source loader already keys files by relative path, so compilation is unchanged.
- `client/` is reserved for a compiled client artifact and is absent until the client plugin architecture is implemented.
- The bundle carries no separate content hash. Package identity remains the existing source hash derived from the manifest and file map.
- Test files are excluded from bundles.

### Plugin CLI

- `@ryot/cli` exposes a `ryot` binary with exactly one command, `plugin build`. No other subcommand is added by this plan.
- The command loads the plugin package's manifest entry, decodes it through `PluginManifest`, and fails with the decode error when invalid. Manifest validity becomes a build-time guarantee rather than a boot-time one.
- The command supports an output directory and a watch mode. The default output is the plugin package's `dist/bundle`.
- The command is the plugin package's `build` script, so ordinary turbo build ordering produces bundles for any consumer that needs them.

### System Plugin Discovery

- A new configuration field `server.pluginsSystemDir`, environment key `SERVER_PLUGINS_SYSTEM_DIR`, names the directory of system plugin bundles. Its default is `./plugins`.
- Every immediate subdirectory containing `manifest.json` is a system plugin bundle. Discovery decodes the manifest, reads the backend sources, and hands the result to the existing trusted ingestion path unchanged.
- Discovery order is the sorted directory name. This flips the current media-before-fitness order and therefore the default installation sort order for new users. Installation order is already user-controlled, and the kernel cannot meaningfully order third-party plugins, so the change is accepted rather than preserved through a manifest ordering field.
- An absent or empty directory yields zero system plugins and is not an error, because a plugin-free kernel image is a valid build. A present but malformed bundle fails startup.
- The directory is trusted exactly as the rest of the image is. Its contents receive system scope. Mounting additional bundles into it is an operator decision with that consequence, and is documented as such.
- `bootConfiguredPluginSlugs` is replaced by a service holding the discovered slug set. The existing uninstall guard consumes that service instead of a module constant.
- `boot-sources.ts` is deleted and both plugin dependencies are removed from the kernel package.

### Filesystem Configuration

- Path fields default relative to the working directory. The image working directory is `/home/ryot`, so every production path is unchanged.

  | Field                       | Environment key                 | Default     | Image path            |
  | --------------------------- | ------------------------------- | ----------- | --------------------- |
  | `server.pluginsSystemDir`   | `SERVER_PLUGINS_SYSTEM_DIR`     | `./plugins` | `/home/ryot/plugins`  |
  | `fileStorage.localDir`      | `FILE_STORAGE_LOCAL_DIR`        | `./storage` | `/home/ryot/storage`  |
  | `fileStorage.localTempDir`  | `FILE_STORAGE_LOCAL_TEMP_DIR`   | `./work`    | `/home/ryot/work`     |
  | `sandbox.denoDir`           | `SANDBOX_DENO_DIR`              | `./tmp`     | `/home/ryot/tmp`      |

- The Dockerfile's explicit sandbox directory environment variable becomes redundant and is removed.
- No new configuration field is added for the Drizzle migrations directory. The existing working-directory-relative resolution is retained and satisfied in development by the assembly step.
- Path handling is expressed entirely in the configuration definition. No process injects path environment variables for development or tests.
- The relative defaults make the working directory load-bearing. Every invocation path sets it deliberately: the image command runs under the image working directory, the development supervisor runs from `apps/server`, and the end-to-end setup spawns from `apps/server`.

### Server Assembly

- `kernel/backend/src/boot/layers.ts` exports discrete stages instead of one pre-sequenced application layer: schema migration, system plugin ingestion, and the runtime server. Layer definitions do not move; only the ordering leaves the kernel.
- `apps/server/src/main.ts` sequences those stages and splices the legacy migration between schema migration and system plugin ingestion, matching the current ordering.
- The kernel gains no hook, extension point, or plugin-shaped seam for migration. A generic seam whose only implementation is the Rust V10 migration would be a fiction; explicit sequencing in the composition root is the honest form.
- The migration-only mode and its script are preserved and move to `apps/server`, so the legacy validation runbook of restoring a dump and running a migration-only process is unchanged.
- `apps/server` gains an `assemble` task that reproduces the image layout inside its own package directory: one built bundle per shipped plugin under `plugins/`, a link to the kernel's Drizzle migrations at `src/drizzle`, and the storage, working, and sandbox directories. All of it is ignored by version control.
- The development script runs assembly in watch mode alongside the server and restarts the server when a bundle changes. Re-ingestion is already short-circuited by the unchanged source hash, so only a genuinely changed plugin is recompiled.
- The end-to-end setup depends on assembly and spawns from `apps/server`, so tests exercise the same discovery path as production.

### Legacy Migration

- The legacy bootstrap module moves to `migrations/v10-rust` with its documentation and its agent guidance. It depends on `@ryot/kernel-backend` through the package export map.
- `kernel/backend/src/lib/infrastructure/db/migrate.ts` no longer imports any migration mapping module and is reduced to schema migration.
- The migration detects Rust V10 tables and no-ops when absent, so it remains safe on every boot of a TypeScript-native database.
- There is no separate migration image, tag, or operator command. Upgrading remains an image tag change, and `apps/docs/src/migration.md` continues to describe that flow.
- Migration scope, field mappings, reporting behavior, restart safety, intentional omissions, and fail-fast rules are unchanged. This plan relocates the code and inverts the dependency direction; it does not revise the migration.
- The kernel's agent guidance loses its clauses naming legacy bootstrap as the exception to normal write paths, because the exception no longer lives in the kernel.

### Kernel Test Decoupling

- Six kernel test files import plugin packages and must be resolved before the dependencies can be dropped.

  | File                                                        | Current use                                    | Resolution                                    |
  | ----------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
  | `lib/property-schema/property-schema.test.ts`                | media property schemas as input                | kernel-owned fixtures                         |
  | `lib/property-schema/property-schema-runtime.test.ts`        | media property schema as input                 | kernel-owned fixtures                         |
  | `lib/property-schema/property-schema-integration.test.ts`    | media and fitness property schemas as input    | kernel-owned fixtures                         |
  | `modules/definition-registry/service.test.ts`                | real manifests for registry indexing           | synthetic manifests                           |
  | `modules/definition-registry/plugin-signal-schemas.test.ts`  | real manifests for signal indexing             | synthetic manifests                           |
  | `lib/infrastructure/sandbox-runtime/runner-integration.test.ts` | real scripts as host-bridge subjects, and a shipped-script smoke test | fixtures for the first, plugin packages for the second |

- The first five use plugin schemas as convenient realistic input while testing kernel behavior. Kernel-owned fixtures are equivalent coverage with correct isolation, and the plugins module already carries sandbox test fixtures for this purpose.
- The host-bridge subjects in the runner integration test become kernel-owned sandbox fixtures, because the kernel is testing its own bridge.
- The assertion that every shipped script compiles and loads in the sandbox genuinely requires real plugins and moves into the plugin packages. Each plugin proves its own scripts load, which is exactly what a third-party author would write. Plugin packages therefore gain development dependencies on `@ryot/sandbox-compiler` and `@ryot/kernel-backend` for the sandbox runner. A plugin depending on the kernel is the correct direction and introduces no cycle.

### Kernel Sandbox Scripts

- Kernel sandbox script sources are embedded at build time into a generated module, using the same technique already used to embed the generated Deno runner source.
- The Dockerfile stops copying kernel scripts into an absolute root path, and the kernel stops resolving them through path arithmetic against the bundle location.

### Architecture Checks

- The term-scanning purity checker, its vocabulary derivation, its allowlist, and their tests are deleted. The guarantee they approximated is now structural: the kernel package cannot resolve a plugin.
- Runtime module cycle detection and duplicate service-layer detection are unrelated to domain vocabulary, remain valuable, and are preserved under a new architecture check entry point. The kernel's check script runs that instead of the purity script.

### Documentation Generation

- Configuration reference generation leaves the server entirely. It is not a subcommand of `@ryot/cli`, which stays single-purpose.
- `apps/docs` becomes a documentation assembly. A script imports the kernel configuration definition and reads the manifests of the built plugin bundles, then writes the generated include. The docs package declares development dependencies on the plugin packages for build ordering.
- The generated output, the documentation page structure, and the include are unchanged. Configuration documentation is not split along kernel and plugin lines, because the documentation site is product documentation for a media tracker and self-hosters want one list of environment variables.
- The rendering helper in the configuration package keeps its current signature. It already names no plugin; only its caller changes.
- Generation runs as a repository task rather than as a side effect of development startup, and the generated file stays committed and reviewable.
- The orphaned V1 configuration schema include is deleted.

## Testing Decisions

- Kernel unit and integration tests must pass with no plugin package resolvable from the kernel workspace.
- Plugin packages own the assertion that every declared script compiles and loads in the sandbox runtime.
- Bundle production is covered by asserting that a built bundle decodes through the canonical manifest schema and that its declared script entries exist in the bundle.
- Discovery is covered by asserting deterministic ordering, that an absent directory yields no system plugins, and that a malformed bundle fails startup.
- The end-to-end suite is the assurance that discovery, assembly, and ingestion compose correctly; it must not gain a development-only loading path.
- Legacy migration keeps its existing rule of no unit tests and validation against restored legacy dumps through the documented runbook.
- Configuration reference generation is verified by the generated file being unchanged relative to the current output apart from the header.

## Out Of Scope

- The plugin archive transport and upload lifecycle, which is planned separately in [Plugin Package Transport](../plugin-transport/README.md).
- Any implementation of the client plugin architecture, including the client plugin SDK, the client UI SDK, the client compiler, the bridge, and iframe hosting.
- Removing the client's dependency on media query recipes, which is addressed when the client plugin architecture is implemented.
- Plugin management or plugin installation user interface.
- Revising legacy migration scope, mappings, reporting, or omissions.
- Deleting the Rust V10 backend or the V1 web frontend.
- Changing sandbox compilation, the sandbox runtime, host capabilities, or execution authority.
- Changing plugin ingestion, installation lifecycle, definition qualification, or backup semantics.
- Splitting configuration documentation along kernel and plugin lines.
- A separate migration image, tag, or operator-invoked migration command.

## Further Notes

- The dependency direction is the guarantee. After this plan the kernel cannot import a plugin because the package does not resolve, which is stronger than any check that reads source text.
- The image assembly and the development assembly are the same operation expressed twice. Keeping them structurally identical is what allows development and production to share one set of configuration defaults.
- Relative path defaults are a deliberate trade. They remove all path environment handling at the cost of making the working directory significant, and every invocation path in the repository sets it explicitly.
- The reserved `client/` directory inside each plugin bundle exists so the accepted client architecture can be implemented without revisiting the bundle format or the image layout.
- Slug-ordered discovery changes a user-visible default ordering for newly created accounts. This is accepted rather than preserved, because ordering is already a user preference and cannot be authored for third-party plugins.
