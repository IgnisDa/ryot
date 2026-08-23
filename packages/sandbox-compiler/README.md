# Sandbox Compiler

`@ryot-app/sandbox-compiler` compiles backend TypeScript into format-1 Deno ESM. It owns sandbox
source policy, manifest extraction, workflow checks, compiler limits, and sandbox diagnostics. It
uses `@ryot-app/vite-compiler` for the staged filesystem workspace and the protected Vite build.

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

The compiler first creates a TypeScript 7 no-emit project. Strict semantic diagnostics, manifest
literal extraction, definition and declaration checks, import policy, and workflow determinism checks
must pass before Vite runs. A semantic or policy failure never reaches the build stage.

Each build acquires a scoped workspace through `@ryot-app/vite-compiler`. The workspace contains
`source/` for supplied files, `generated/` for compiler-owned entries, and `output/` for Vite output.
The source is staged under `source/`; a generated entry re-exports the selected sandbox entry. A
workspace may use the supervisor's `parentPath` and `jobId`, and its scope removes the workspace.

The sandbox Vite profile emits one unminified ESM module. It targets ES2022, disables module preload,
uses inline source maps, and disables CSS splitting and code splitting. Backend entries emit exactly
one `sandbox.mjs` file. The runner and trusted runtime preparation use the same profile with their
own configured output filenames.

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

The list is derived from the runtime registry in `@ryot-app/sandbox-sdk`. Other approved SDK entry
points are bundled through the compiler-owned aliases. Runtime aliases for Effect and RyotQL resolve
to the same files, so SDK and plugin-kit imports keep one module identity.

## Output Audit

The compiler requires exactly the expected output file and checks Vite diagnostics, compiled size,
source-map paths, and emitted runtime imports. The audit rejects Node, Bun, npm, remote, and JSR
imports; CommonJS loading; browser-only Vite helpers; and any external specifier not in the exact
runtime list. The result is a format-1 module with an inline source map and no chunks.

## Host, Supervision, And Limits

Bun is used for the worker host, dependency resolution, filesystem Layer, and worker packaging. The
compiled sandbox module is not a Bun artifact; it executes in Deno.

The parent supervisor creates a UUID job directory, passes its path and job ID to the worker, and
removes that directory with scoped acquire/use/release cleanup after success, failure, cancellation,
timeout, or forced termination. The worker is run with no orphan processes and is killed on cleanup.

Compiler limits are two concurrent jobs, a 5-second timeout, 256 MiB sampled Linux process-tree
memory, 256 KiB source, 1 MiB compiled JavaScript, 100 diagnostics, and 256 KiB diagnostic output.
