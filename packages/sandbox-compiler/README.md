# Sandbox Compiler

`@ryot-app/sandbox-compiler` compiles backend TypeScript into format-1 Deno ESM. It owns sandbox
source policy, manifest extraction, workflow checks, compiler limits, and sandbox diagnostics. It
uses `@ryot-app/vite-compiler` for the complete Deno ESM build profile and scoped workspace.

## Public Entrypoints And Callers

| Entrypoint                                | Public surface                                                                               | Main callers                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `./worker`                                | Standalone JSON stdin/stdout compiler worker                                                 | The kernel sandbox compiler supervisor and the packaged-worker smoke test |
| `./builtins`                              | `compileBuiltInSandboxEntry` and `compileSandboxPackageEntries`                              | Built-in compiler tests and backend tooling                               |
| `./platform`                              | `sandboxCompilerPlatformLayer`, the Bun file system and Vite build services compiles require | Entrypoints and test harnesses that run compiles                          |
| `./plugins`                               | `compilePluginSandboxEntries`, `compilePluginSandboxSourceEntries`, and entry-path helpers   | Kernel plugin bootstrap and sandbox runner tests                          |
| `./plugin-manifest`                       | `derivePluginSandboxScripts` and `compilePluginManifestScripts`                              | `ryot plugin build` and kernel plugin ingestion                           |
| `./protocol`, `./diagnostics`, `./limits` | Worker wire types, diagnostics, and shared limits                                            | Kernel supervisors, runtime services, and CLI code                        |
| `./runtime-build/*`                       | Trusted dependency registry, payload, source walking, and process capture                    | Kernel build and server runtime-image verification                        |

Compile functions require `FileSystem` and `ViteBuildService`; callers provide
`sandboxCompilerPlatformLayer` at their entrypoint. Standalone user scripts enter through `./worker`. Built-ins and plugin manifest scripts use the same
semantic and Vite Deno build stages, but retain their separate public APIs and metadata checks.

## Build Pipeline

The compiler creates a TypeScript 7 no-emit project and reports bounded semantic diagnostics. It then
inspects each entry, validates declarations, workflows, and literal manifests, and compiles validated
entries with bounded concurrency. A semantic or policy failure never reaches the build stage.

## Execution Metadata

Each entry is analyzed inside the same bounded TypeScript project used for semantic checks. The
analyzer follows used local declarations, ordinary helpers, closures, direct host-method references,
and local forwarding methods. It emits sorted, entry-local capabilities plus required and optional
configuration keys, OAuth connection fields, and executable dependencies. Child executables do not
add grants to their parent. Workflow replay has no local host capabilities; workflow metadata keeps
its own analyzed configuration and executable-dependency facts.

The authored `defineManifest` contains static identity and kind plus kind-specific fields such as an
automation `inputProjection` or provider `searchOptionsSchema`; capabilities and execution
requirements are not authored there. Source-authored fields and compiler-derived execution metadata
remain separate when the plugin build derives and validates script records. Installation recomputes
those records from source, so archive metadata cannot widen a script.

Configuration calls must be direct and use a literal object with finite required and optional key
lists. `activity`, `child`, and `executeWorkflow` calls must use direct typed references or finite
alternatives for their executable targets. Configuration, OAuth, and executable-reference method
aliases are unsupported. Non-finite host indexing, reflection or type-erasure of host objects, and
host escape to unresolved or external functions are rejected rather than guessed. Finite dependency
targets and OAuth fields are checked from their call arguments.

The analysis caches symbol, type, alias, and declaration queries and has a project-local step limit
of 100,000. If traversal or checker queries exhaust the limit, compilation fails with
`RYOT_ANALYSIS_LIMIT`; it never emits partial metadata.

SDK intrinsic capabilities use canonical module and declaration identity, as summarized by
`SANDBOX_SDK_INTRINSICS` in `@ryot-app/sandbox-sdk/src/intrinsics.ts`:

| SDK source file     | Exported functions                                       | Inferred capability |
| ------------------- | -------------------------------------------------------- | ------------------- |
| `src/youtubei.ts`   | `createYoutubeMusicClient`, `createYoutubeHistoryClient` | `httpCall`          |
| `src/filesystem.ts` | `readArtifact`, `readArtifactRange`, `readNamedArtifact` | `artifact-read`     |
| `src/filesystem.ts` | `writeScratchChunks`                                     | `scratch`           |

Keep those source filenames and exports aligned with the intrinsic map. Tests in
`src/compiler-capabilities.test.ts` cover canonical SDK identity, helper forwarding, per-entry
metadata, and analysis-limit failures.

A build acquires a scoped workspace through `@ryot-app/vite-compiler` and stages the package under
`source/`. A workspace may use the supervisor's `parentPath` and `jobId`, and its scope removes the
workspace. A standalone user script builds its single entry with `buildDenoEsm`; built-ins and plugin
manifests build every validated entry of one package with `buildDenoEsmPackage`, which stages the
package once and reuses that workspace for each entry.

The shared Deno profile emits exactly one `sandbox.mjs` module as unminified ES2022 ESM with an inline
source map and no CSS, module preload, or code splitting. Runner and trusted runtime generation use
the same `buildDenoEsm` API with their own output filenames.

The kernel's `tooling/sandbox-runtime.ts` assembles generated runner, payload, and kernel script files.
`src/runtime-build/` owns the generic registry and deterministic payload construction, bounded source
watch inputs, and process capture for the production runtime-image verification. The compiler package
does not depend on kernel modules.

Because source-map paths stay relative to the staged package, a mapped runtime stack frame names the
authored source (`script.ts` for a user script, `backend/...` for a plugin entry) and the sandbox
runner reports frames under the compiled module's own directory.

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

Compiler limits are two concurrent jobs, a 5-second timeout, 384 MiB sampled Linux process-tree
memory, 256 KiB source, 1 MiB compiled JavaScript, 100 diagnostics, and 256 KiB diagnostic output.
