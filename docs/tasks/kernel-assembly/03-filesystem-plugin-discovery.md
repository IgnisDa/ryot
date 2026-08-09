# Filesystem Plugin Discovery

**Parent Plan:** [Kernel Assembly](./README.md)

**Status:** pending

## What to build

Make the kernel load system plugins from a configured directory of bundles and remove its compile-time knowledge of any plugin. Follow the parent plan's System Plugin Discovery, Filesystem Configuration, Server Assembly, and Kernel Test Decoupling decisions. This is the task that makes the kernel structurally domain-agnostic, and it must land together with the development and test assembly that keeps the loop usable.

Add a `server.pluginsSystemDir` configuration field defaulting to a working-directory-relative `./plugins`, and convert the local storage, local working, and sandbox directory fields to working-directory-relative defaults. Because the image working directory is `/home/ryot`, every production path is byte-identical to today, so remove the now-redundant sandbox directory environment variable from the Dockerfile. Do not add a configuration field for the Drizzle migrations directory and do not introduce any process that injects path environment variables.

At boot, treat every immediate subdirectory containing `manifest.json` as a system plugin bundle: decode the manifest, read the backend sources, and hand the result to the existing trusted ingestion path unchanged. Order discovery by sorted directory name, accepting that this flips the current media-before-fitness ordering and therefore the default installation sort order for new accounts. An absent or empty directory yields zero system plugins and is not an error, because a plugin-free kernel image is a valid build; a present but malformed bundle fails startup. Replace the boot-configured slug constant with a service holding the discovered slug set, and have the existing uninstall guard consume that service. Delete boot sources and remove both plugin dependencies from the kernel package.

Add an `assemble` task to `apps/server` that reproduces the image layout inside its own package directory: one built bundle per shipped plugin under `plugins/`, a link to the kernel's Drizzle migrations at `src/drizzle`, and the storage, working, and sandbox directories. Ignore all of it in version control. Make the development script run assembly in watch mode alongside the server and restart the server when a bundle changes; re-ingestion is already short-circuited by an unchanged source hash, so only a genuinely changed plugin recompiles. Make the end-to-end setup depend on assembly and spawn from `apps/server`, so tests exercise the same discovery path as production. Remove the path variables from the checked-in developer environment file.

Resolve the six kernel test files that import plugin packages, per the parent plan's disposition table. Replace plugin schemas used as realistic input with kernel-owned fixtures, replace real manifests used for registry and signal indexing with synthetic manifests, and convert the runner integration test's host-bridge subjects to kernel-owned sandbox fixtures. Move the assertion that every shipped script compiles and loads in the sandbox into the plugin packages themselves, adding the sandbox compiler and the kernel runner as plugin development dependencies.

## Acceptance criteria

- [ ] The kernel discovers system plugins by reading bundles from the configured directory and ingests them through the existing trusted path.
- [ ] Discovery order is the sorted bundle directory name, and the resulting order is deterministic across restarts.
- [ ] An absent or empty plugin directory starts the server with zero system plugins, and a malformed bundle fails startup with a clear error.
- [ ] The boot-configured slug constant is replaced by a service holding the discovered set, and the uninstall guard consumes it.
- [ ] `@ryot/kernel-backend` declares no dependency on any plugin package, in production or development dependencies.
- [ ] The kernel test suite passes with no plugin package resolvable from the kernel workspace.
- [ ] Each plugin package proves that every script it declares compiles and loads in the sandbox runtime.
- [ ] The plugin, storage, working, and sandbox directory fields default relative to the working directory and resolve to their current image paths.
- [ ] The Dockerfile no longer sets the sandbox directory environment variable.
- [ ] A clean checkout runs the development server after assembly with no path environment variables configured anywhere.
- [ ] Editing a plugin sandbox script rebuilds its bundle and restarts the server, and unchanged plugins are not recompiled.
- [ ] The end-to-end suite runs against the same discovery path as production, with no development-only loading mode.
- [ ] Repository check and test tasks pass.
