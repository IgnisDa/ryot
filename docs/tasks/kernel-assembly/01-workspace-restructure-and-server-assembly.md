# Workspace Restructure And Server Assembly

**Parent Plan:** [Kernel Assembly](./README.md)

**Status:** pending

## What to build

Establish the final workspace layout and the composition root before any behavioral work, so every later task writes final paths and final package names. Follow the parent plan's Workspace Layout and Kernel Package Boundary decisions.

Move the application backend to `kernel/backend` as `@ryot/kernel-backend` and the application client to `kernel/client` as `@ryot/kernel-client`. Add `kernel/*` and `migrations/*` to the workspace globs. Give the kernel package an export map exposing its source modules by subpath, so dependents import defining modules directly rather than through barrels. Internal path imports are unchanged.

Create `apps/server` as `@ryot/server`. It takes ownership of the process entry point, the build output, the development supervisor script, and the migration-only script. The kernel package stops declaring a runnable entry point and stops owning those scripts. At this stage the kernel still declares both plugin dependencies and still statically imports plugin manifests through boot sources, so the entry point simply moves; it is Task 03 that removes that coupling.

Restructure both plugin packages so their server-consumed sources live under `backend/`, code shared between halves lives under `shared/`, and a `client/` directory is reserved. Manifest authoring entries stay at the package root. Update the manifests' declared script entries and the plugin package export maps to match.

Delete `@ryot/plugin-testing`, `@ryot/query-engine`, and `@ryot/test-fixtures`, which have no importers. Retain `@ryot/assets`, which is consumed indirectly through its published GitHub URLs.

Update every path-dependent consumer: turbo configuration, TypeScript project configuration, the end-to-end setup's backend working directory, the justfile, and the Dockerfile's build filters and copy sources. This task must not change runtime behavior, configuration, or the shipped image contents.

## Acceptance criteria

- [ ] The backend and client packages live under `kernel/` with their new package names, and every workspace reference resolves.
- [ ] `@ryot/kernel-backend` exposes its source modules through a subpath export map, and no barrel re-export module is introduced.
- [ ] `apps/server` owns the process entry point, the build output, the development supervisor, and the migration-only script.
- [ ] The kernel package declares no runnable entry point and no longer owns process commands.
- [ ] Both plugin packages expose their server-consumed sources under `backend/`, reserve `client/`, and declare matching script entries and export subpaths.
- [ ] `@ryot/plugin-testing`, `@ryot/query-engine`, and `@ryot/test-fixtures` are deleted, and `@ryot/assets` is retained.
- [ ] Turbo, TypeScript, end-to-end setup, justfile, and Dockerfile references are updated to the new paths.
- [ ] The built image contents, runtime behavior, and configuration surface are unchanged by this task.
- [ ] Repository check and test tasks pass.
