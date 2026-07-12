# Sandbox Compiler

`@ryot-app/sandbox-compiler` compiles backend TypeScript into format-1 Deno ESM. It owns sandbox
source policy, manifest extraction, workflow checks, compiler limits, and sandbox diagnostics. It
uses `@ryot-app/vite-compiler` for the complete Deno ESM build profile and scoped workspace.

## Public Entrypoints And Callers

| Entrypoint                                | Public surface                                                                                   | Main callers                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `./worker`                                | Standalone JSON stdin/stdout compiler worker                                                     | The kernel sandbox compiler supervisor and the packaged-worker smoke test |
| `./builtins`                              | `compileBuiltInSandboxEntry`, `compileBuiltInSandboxEntries`, and `compileSandboxPackageEntries` | Built-in compiler tests and backend tooling                               |
| `./plugins`                               | `compilePluginSandboxEntries`, `compilePluginSandboxSourceEntries`, and entry-path helpers       | Kernel plugin bootstrap and sandbox runner tests                          |
| `./plugin-manifest`                       | `derivePluginSandboxScripts` and `compilePluginManifestScripts`                                  | `ryot plugin build` and kernel plugin ingestion                           |
| `./protocol`, `./diagnostics`, `./limits` | Worker wire types, diagnostics, and shared limits                                                | Kernel supervisors, runtime services, and CLI code                        |

Standalone user scripts enter through `./worker`. Built-ins and plugin manifest scripts use the same
semantic and Vite Deno build stages, but retain their separate public APIs and metadata checks.

## Build Pipeline

The compiler creates a TypeScript 7 no-emit project and reports bounded semantic diagnostics. It then
inspects each entry, validates declarations, workflows, and literal manifests, and compiles validated
entries with bounded concurrency. A semantic or policy failure never reaches the build stage.

Each `buildDenoEsm` call acquires a scoped workspace through `@ryot-app/vite-compiler` and stages the
package under `source/`. A workspace may use the supervisor's `parentPath` and `jobId`, and its scope
removes the workspace.

The shared Deno profile emits exactly one `sandbox.mjs` module as unminified ES2022 ESM with an inline
source map and no CSS, module preload, or code splitting. Runner and trusted runtime generation use
the same `buildDenoEsm` API with their own output filenames.

Only the following runtime-registry specifiers remain external in a sandbox module:

- `@ryot-app/sandbox-sdk/effect`
- `effect`
- `@ryot-app/plugin-kit/effect`
- `@ryot-app/sandbox-sdk/cheerio`
- `@ryot-app/sandbox-sdk/youtubei`
- `@ryot-app/sandbox-sdk/fflate`
- `@ryot-app/sandbox-sdk/papaparse`
- `@ryot-app/sandbox-sdk/fast-xml-parser`
- `@ryot-app/sandbox-sdk/ryotql`
- `@ryot-app/plugin-kit/ryotql`

`SANDBOX_RUNTIME_EXTERNAL_SPECIFIERS` is derived from `SANDBOX_RUNTIME_REGISTRY` in
`@ryot-app/sandbox-sdk`. Other approved SDK entry points remain compiler-bundled through exact aliases.
Runtime aliases for Effect and RyotQL resolve to the same files, so SDK and plugin-kit imports keep one
module identity.

## Output Audit

`@ryot-app/vite-compiler` validates the exact output, normalizes source maps, and audits emitted runtime
imports. The audit rejects Node, Bun, npm, remote, and JSR imports; CommonJS loading; browser-only Vite
helpers; and any external specifier not in the exact runtime list. The sandbox compiler maps Vite
diagnostics into its public diagnostic model and enforces the compiled-size limit.

## Host, Supervision, And Limits

Bun is used for the worker host, dependency resolution, filesystem Layer, and worker packaging. The
compiled sandbox module is not a Bun artifact; it executes in Deno.

The parent supervisor creates a UUID job directory, passes its path and job ID to the worker, and
removes that directory with scoped acquire/use/release cleanup after success, failure, cancellation,
timeout, or forced termination. The worker is run with no orphan processes and is killed on cleanup.

Compiler limits are two concurrent jobs, a 5-second timeout, 256 MiB sampled Linux process-tree
memory, 256 KiB source, 1 MiB compiled JavaScript, 100 diagnostics, and 256 KiB diagnostic output.
