# Workspace Restructure And Server Assembly

**Parent Plan:** [Kernel Assembly](./README.md)

**Status:** done

## What to build

Establish the final workspace layout and the composition root before any behavioral work, so every later task writes final paths and final package names. Follow the parent plan's Workspace Layout and Kernel Package Boundary decisions.

Move the application backend to `kernel/backend` as `@ryot/kernel-backend` and the application client to `kernel/client` as `@ryot/kernel-client`. Add `kernel/*` and `migrations/*` to the workspace globs. Give the kernel package an export map exposing its source modules by subpath, so dependents import defining modules directly rather than through barrels. Internal path imports are unchanged.

Create `apps/server` as `@ryot/server`. It takes ownership of the process entry point, the build output, the development supervisor script, and the migration-only script. The kernel package stops declaring a runnable entry point and stops owning those scripts. At this stage the kernel still declares both plugin dependencies and still statically imports plugin manifests through boot sources, so the entry point simply moves; it is Task 03 that removes that coupling.

Restructure both plugin packages so their server-consumed sources live under `backend/`, code shared between halves lives under `shared/`, and a `client/` directory is reserved. Manifest authoring entries stay at the package root. Update the manifests' declared script entries and the plugin package export maps to match.

Delete `@ryot/plugin-testing`, `@ryot/query-engine`, and `@ryot/test-fixtures`, which have no importers. Retain `@ryot/assets`, which is consumed indirectly through its published GitHub URLs.

Update every path-dependent consumer: turbo configuration, TypeScript project configuration, the end-to-end setup's backend working directory, the justfile, and the Dockerfile's build filters and copy sources. This task must not change runtime behavior, configuration, or the shipped image contents.

## Acceptance criteria

- [x] The backend and client packages live under `kernel/` with their new package names, and every workspace reference resolves.
- [x] `@ryot/kernel-backend` exposes its source modules through a subpath export map, and no barrel re-export module is introduced.
- [x] `apps/server` owns the process entry point, the build output, the development supervisor, and the migration-only script.
- [x] The kernel package declares no runnable entry point and no longer owns process commands.
- [x] Both plugin packages expose their server-consumed sources under `backend/`, reserve `client/`, and declare matching script entries and export subpaths.
- [x] `@ryot/plugin-testing`, `@ryot/query-engine`, and `@ryot/test-fixtures` are deleted, and `@ryot/assets` is retained.
- [x] Turbo, TypeScript, end-to-end setup, justfile, and Dockerfile references are updated to the new paths.
- [x] The built image contents, runtime behavior, and configuration surface are unchanged by this task, other than the two consequences of the mandated plugin restructure recorded in the implementation notes.
- [x] Repository check and test tasks pass.

## Implementation Notes

- `apps/app-backend` became `kernel/backend` (`@ryot/kernel-backend`) and `apps/app-client` became `kernel/client` (`@ryot/kernel-client`). Both keep their previous depth from the repository root, so every surviving `import.meta.url` computation (plugin package roots, kernel script entries) resolves exactly where it did before, in development and in the image.
- The kernel package declares `"exports": { "./*": "./src/*.ts" }` and also gained `"imports": { "#*": "./src/*.ts" }`. The `#*` map is required, not cosmetic: internal specifiers previously resolved through the kernel's own tsconfig `paths`, which does not apply when `apps/server` type-checks and bundles kernel source.
- `apps/server` owns `src/main.ts`, `scripts/develop.ts`, `scripts/prepare-sandbox-runtime.ts`, `scripts/smoke-compiler-worker.ts`, the `dist` output, and the `dev`, `build`, and `run-migration` commands. The kernel keeps `db:generate`, `purity:check`, `sandbox:compile-runner`, `sandbox:check-runner`, `test`, and `check`.
- The kernel was deliberately not given a `build` script. The generated Deno runner is not a declared turbo output, so a cached kernel build would skip regenerating it and leave the server build without its input. Instead `@ryot/server`'s `build` and `run-migration` run the kernel's own `sandbox:compile-runner` script through `bun run --cwd`, which reproduces the previous single-package ordering while leaving the script's definition owned by the kernel. `@ryot/tests` now depends on `@ryot/server`, so the e2e suite keeps the same build edge it had through `@ryot/app-backend`.
- `apps/server/src/drizzle` is a committed symlink to the kernel's migrations, carrying a `TODO(kernel-assembly)` in `src/main.ts`. The end-to-end setup and development supervisor now run from `apps/server`, and `migrate.ts` still resolves `${process.cwd()}/src/drizzle`. Task 03 replaces the symlink with the ignored `assemble` output.
- `@ryot/sandbox-sdk` was added to `apps/server`'s dependencies. `ensureSandboxRuntimeDependencies` builds three runtime modules from virtual sources, and Bun's bundler resolves those against the process working directory rather than the declared `resolveDir`. With the working directory moved from `apps/app-backend` to `apps/server`, the effect, youtubei, and RyotQL runtime builds failed at boot until the SDK was resolvable there.
- Plugin packages split along the sandbox import closure. For media, `scripts/`, `imports/`, `operations/`, `workflows/`, `schemas/`, and `media-monitoring-ryotql.ts` moved under `backend/`; for fitness, `scripts/`, `import-adapters/`, and `schemas/`. `shared/` stayed a root sibling because both halves use it, `manifest.ts` and its authoring modules stayed at the root, and `client/` is reserved with a `.gitkeep`. Manifest `entry` strings became `backend/scripts/...` and export map targets were retargeted; every subpath key name is unchanged, so no external consumer moved.
- Relative specifiers were rewritten by resolving each one against its file's old location and recomputing it from the new one, rather than by pattern substitution. Whole directories moved together preserving their arrangement, so only crossings into `shared/` and into root-level modules actually changed.
- `packages/plugin-testing`, `packages/query-engine`, and `packages/test-fixtures` held only stale `dist` and `.turbo` output with no `package.json`, so removing them changes no resolution. `packages/assets` is retained.
- The justfile needed no change: it references packages only through `@ryot/tests`, and its worktree and database recipes carry no restructured path.
- `bun turbo check` and `bun turbo test` pass for every package except `@ryot/graphql`, whose `tsc` failure (`No inputs were found`, `moduleResolution=node10 has been removed`) is pre-existing, untouched here, and confined to the V1 frontend chain.
- Affected end-to-end suites run and pass: `kernel/system/plugin-boot`, `kernel/plugins/system-plugin-reconciliation`, `kernel/plugins/plugins`, `plugins/fitness/exercises`, `plugins/media/events/automations`, and `kernel/definitions/definitions`.
- The generated configuration reference under `apps/docs/src/includes` is unchanged in content after the restructure, confirming the configuration surface is unchanged. Its committed form does carry a whitespace-only reformat of thirteen markdown table separator rows, because `@ryot/docs` runs `oxfmt --write` over a generated file whose generator emits unpadded tables. That oscillation predates this task and reproduces on `main`; Task 06 owns the generator and can settle it.
- Two image consequences follow unavoidably from the mandated `backend/` split rather than from any deliberate change here, and are recorded rather than hidden. Plugin paths under `/plugins` gained a `backend/` segment and each plugin now ships an empty `client/`. More significantly, `loadPluginSource` globs `**/*.ts` and keys the file map by package-relative path, so every moved file changes its key and therefore the derived source hash; both system plugins re-ingest and recompile once on the first boot after upgrade. Both are benign on a greenfield project with no production data.
