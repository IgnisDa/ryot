# Sandbox Compiler

`@ryot-app/plugin-backend-compiler` compiles backend TypeScript into format-1 sandbox ESM. It owns sandbox
source policy, manifest extraction, workflow checks, compiler limits, and sandbox diagnostics. It
uses `@ryot-app/vite-compiler` for the complete Sandbox ESM build profile and scoped workspace.

## Public Entrypoints And Callers

| Entrypoint                                | Public surface                                                                                      | Main callers                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `./worker`                                | Long-lived compiler worker that warms up and then serves one JSON request per line                  | The supervisor, as the source or packaged worker path           |
| `./supervisor`                            | `makeSandboxCompilerSupervisor`                                                                     | The kernel `SandboxCompiler` and the packaged-worker smoke test |
| `./warm-up`                               | `SANDBOX_COMPILER_WARM_UP_SOURCE`, the script each worker compiles before accepting jobs            | The worker and the packaged-worker smoke test                   |
| `./builtins`                              | `compileBuiltInSandboxEntry` and `compileSandboxPackageEntries`                                     | Built-in compiler tests and backend tooling                     |
| `./platform`                              | Platform Layers with the Bun file system, Vite build, and TypeScript session services compiles need | Entrypoints and test harnesses that run compiles                |
| `./plugins`                               | `compilePluginSandboxEntries`, `compilePluginSandboxSourceEntries`, and entry-path helpers          | Kernel source-zero generation and sandbox runner tests          |
| `./plugin-manifest`                       | `derivePluginSandboxScripts` and `compilePluginManifestScripts`                                     | Local `ryot plugin build` and compiler tests                    |
| `./script-metadata`                       | `declaredScriptMetadata`, the compile-free metadata view of a declared plugin script                | Kernel plugin ingestion                                         |
| `./protocol`, `./diagnostics`, `./limits` | Worker wire types, diagnostics, and shared limits                                                   | Kernel supervisors, runtime services, and CLI code              |
| `./runtime-build/*`                       | Trusted dependency registry, payload, source walking, and process capture                           | Kernel build and server runtime-image verification              |

Compile functions require `FileSystem`, `ViteBuildService`, and `TypeScriptSession`; callers provide
`pluginBackendCompilerPlatformLayer` at their entrypoint, so every compile in that scope shares one
TypeScript server. `pluginBackendCompilerEnvironmentLayer` also type-checks the SDK and other
resolved dependencies to verify the compiler environment. Standalone user scripts enter through `./worker`. Built-ins and plugin manifest scripts use the same
semantic and Vite Sandbox ESM build stages, but retain their separate public APIs and metadata checks.

## Build Pipeline

The compiler creates a TypeScript 7 no-emit project, inspects each entry's import policy and
definition shape, and then reports bounded semantic diagnostics for the project files. Program and
configuration errors outside the project, and dependency type errors under environment verification,
fail with `RYOT_COMPILER_ENVIRONMENT` instead of being attributed to the script. Only inspected entries reach
validation of execution metadata, declarations, workflows, and literal manifests; validated entries
compile with bounded concurrency. A semantic or policy failure never reaches the build stage.

Standalone and package adapters use the same validated-entry stage for manifest identity, execution
metadata, workflow imports and determinism, declaration matching, and capabilities. Standalone entries
reject relative imports; package workflows validate their reachable local source graph.

## Execution Metadata

Each entry is analyzed inside the same bounded TypeScript project used for semantic checks. The
analyzer follows used local declarations, ordinary helpers, closures, direct host-method references,
and local forwarding methods. It emits sorted, entry-local capabilities plus required and optional
configuration keys, OAuth connection fields, and executable dependencies. Child executables do not
add grants to their parent. Workflow replay has no local host capabilities; workflow metadata keeps
its own analyzed configuration and executable-dependency facts.

The authored `defineManifest` contains static identity and kind plus kind-specific fields such as an
automation `inputProjection`, provider `searchOptionsSchema`, related-only `relatedInputs`, or translate-only `translationInputs`; capabilities and execution
requirements are not authored there. Source-authored fields and compiler-derived execution metadata
remain separate when local plugin builds derive and validate script records. Runtime installation
validates archive metadata and hashes without recompiling or proving that metadata came from source.

Configuration calls must be direct and use a literal object with finite required and optional key
lists. `activity`, `child`, and `executeWorkflow` calls must use direct typed references or finite
alternatives for their executable targets. Configuration, OAuth, and executable-reference method
aliases are unsupported. Non-finite host indexing, reflection or type-erasure of host objects, and
host escape to unresolved or external functions are rejected rather than guessed. Finite dependency
targets and OAuth fields are checked from their call arguments.

Analysis is project-bounded; exhausting its 100,000-step limit fails with `RYOT_ANALYSIS_LIMIT`,
never partial metadata.

`SANDBOX_SDK_INTRINSICS` in the backend SDK maps filesystem/network helpers to capabilities by
canonical module/declaration identity, not local aliases. `src/compiler-capabilities.test.ts` covers
that identity, forwarding, per-entry metadata, and analysis limits.

A build acquires a scoped workspace through `@ryot-app/vite-compiler` and stages the package under
`source/`. A workspace may use the supervisor's `parentPath` and `jobId`, and its scope removes the
workspace. A standalone user script builds its single entry with `buildSandboxEsm`; built-ins and plugin
manifests build every validated entry of one package with `buildSandboxEsmPackage`, which stages the
package once and reuses that workspace for each entry.

The [Sandbox ESM profile](../vite-compiler/README.md) owns single-module ES2022 emission and output
auditing. Plugin source maps retain relative authored paths/line mappings without `sourcesContent`;
runtime frames resolve against the compiled module. Archives contain compiled artifacts, not source,
and installation never invokes this compiler or proves source provenance.

The sandbox's `tooling/runtime.ts` assembles the trusted runner and runtime payload; the backend's `tooling/kernel-scripts.ts` generates kernel script files.
`src/runtime-build/` owns the generic registry and deterministic payload construction, bounded source
watch inputs, and process capture for the production runtime-image verification. The compiler package
does not depend on kernel modules.

`SANDBOX_RUNTIME_REGISTRY` in the backend SDK is the authority for external runtime specifiers;
`SANDBOX_RUNTIME_EXTERNAL_SPECIFIERS` is derived from it. Other approved SDK entries are bundled via
exact aliases. Effect/RyotQL aliases share module identity across SDK and Plugin Kit imports.

`@ryot-app/plugin-backend-sdk/markdown` is a data-tier runtime module. The dependency-free
`@ryot-app/plugin-backend-sdk/markdown-text` entry point is compiler-bundled and does not raise the snapshot tier.

## Output Audit

`@ryot-app/vite-compiler` validates the exact output, normalizes source maps, and audits emitted runtime
imports. The audit rejects Node, Bun, npm, remote, and JSR imports; CommonJS loading; browser-only Vite
helpers; and any external specifier not in the exact runtime list. The sandbox compiler maps Vite
diagnostics into its public diagnostic model and enforces the compiled-size limit.

## Host, Supervision, And Limits

Bun is used for the worker host, dependency resolution, filesystem Layer, and worker packaging. The
compiled sandbox module executes in a fresh V8 isolate inside `ryot-sandboxd`.
Worker dependencies resolve from the installed plugin-backend-compiler package, including when the worker
is bundled into a different directory.

`makeSandboxCompilerSupervisor` runs `./worker` in a `@ryot-app/compiler-worker` pool. Each worker
compiles `SANDBOX_COMPILER_WARM_UP_SOURCE` before it accepts jobs and then stays warm, so a job type
checks only its own source against already-loaded SDK declarations. The pool passes each job a
workspace address and removes that workspace after success, failure, cancellation, timeout, or forced
termination. The supervisor bounds source size before dispatch and decodes the returned manifest.
Timeouts, memory overruns, and oversized responses fail the job with `RYOT_COMPILER_TIMEOUT`,
`RYOT_COMPILER_MEMORY`, or `RYOT_COMPILER_PROCESS` diagnostics; a worker that cannot start, exits,
returns an invalid result, or loses memory supervision fails with `CompilerWorkerUnavailable`.

Runtime jobs trust the SDK and its dependencies. The server image build runs the smoke script, whose
workers verify the full environment with `--verify-environment`; SDK type errors then fail the build
with `RYOT_COMPILER_ENVIRONMENT` instead of reaching runtime compiles.

Compiler limits are two concurrent workers, a 5-second job timeout, a 30-second warm-up timeout, a
5-minute idle timeout, 768 MiB sampled Linux process-tree memory with recycling above 512 MiB, an
8 MiB response, 256 KiB source, 1 MiB compiled JavaScript, 100 diagnostics, and 256 KiB diagnostic
output. The native TypeScript server's `GOMEMLIMIT` is 256 MiB: lower budgets sit below its working
heap and make the Go collector dominate warm compiles. This is a soft Go GC budget; the pool still
kills the worker when the full process tree exceeds the hard memory limit.

The agent SDK entry point is an allowed sandbox import and uses the same direct `defineScript` /
`defineManifest` declaration analysis and compiler-derived host metadata. It does not create a separate
compiler or capability policy; backend agent authority restricts the capabilities accepted for a run.
