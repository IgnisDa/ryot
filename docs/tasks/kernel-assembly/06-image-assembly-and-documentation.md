# Image Assembly And Documentation

**Parent Plan:** [Kernel Assembly](./README.md)

**Status:** pending

## What to build

Make the image definition the place that decides which plugins ship, move configuration reference generation to the documentation assembly, and bring every document in line with the new structure. Follow the parent plan's Documentation Generation decisions and its Workspace Layout consequences.

Rewrite the Dockerfile around explicit assembly. Prune for the server, the client kernel, the shipped plugin packages, and the migration package. Build plugin bundles in their own stage. In the runner, copy the server output, the client output, and one directory per shipped plugin into the plugin directory that the kernel discovers. Adding or removing a shipped plugin becomes a copy line, and a plugin-free kernel image is those lines removed. The sandbox compiler runtime stage, the Deno installation, the compiler smoke test, and the sandbox runtime preparation step are unchanged.

Move configuration reference generation out of the server entirely. Add a script to `apps/docs` that imports the kernel configuration definition and reads the manifests of the built plugin bundles, then writes the generated include. Declare the plugin packages as documentation development dependencies for build ordering. Keep the generated output, the documentation page structure, and the include unchanged: configuration documentation is not split along kernel and plugin lines, because the site is product documentation and self-hosters want one list of environment variables. The rendering helper in the configuration package keeps its current signature; only its caller changes. Run generation as a repository task rather than as a side effect of development startup, keep the output committed, and correct the generated file's header, which currently claims it is written on development server startup. Delete the orphaned V1 configuration schema include.

Update documentation to the new structure. The root agent guidance gains the workspace map covering the kernel, the server assembly, plugins, migrations, and the CLI. New agent guidance is added for `apps/server`, `@ryot/cli`, and the migration package. The repository README's development instructions reflect the new commands and the reduced environment setup. Verify that the published migration guide still describes the correct upgrade flow, which it should, because the runbook is deliberately unchanged.

## Acceptance criteria

- [ ] The Dockerfile builds plugin bundles in a dedicated stage and copies one directory per shipped plugin into the discovered plugin directory.
- [ ] Removing the plugin copy lines produces a working plugin-free kernel image.
- [ ] The image contains no path derived from the repository source layout, and the sandbox compiler runtime, Deno installation, smoke test, and sandbox runtime preparation steps still work.
- [ ] Configuration reference generation runs from `apps/docs`, reading the kernel configuration definition and built bundle manifests.
- [ ] The server writes nothing into the documentation site at startup.
- [ ] The generated configuration reference is unchanged apart from a corrected header, and remains a single committed include on a single page.
- [ ] The configuration rendering helper keeps its signature and names no plugin.
- [ ] The orphaned V1 configuration schema include is deleted.
- [ ] Root agent guidance documents the workspace map, and `apps/server`, `@ryot/cli`, and the migration package have their own guidance.
- [ ] The repository README reflects the new development commands and the reduced environment setup.
- [ ] The published migration guide still describes the supported upgrade flow.
- [ ] Repository check and test tasks pass.
