# Sandbox Compiler

`@ryot-app/plugin-backend-compiler` compiles backend TypeScript into format-1 sandbox ESM. It owns sandbox
source policy, manifest extraction, workflow checks, compiler limits, and sandbox diagnostics. It
uses `@ryot-app/vite-compiler` for the complete Sandbox ESM build profile and scoped workspace.

## Public Entrypoints And Callers

| Entrypoint                                | Public surface                                                                                     | Main callers                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `./worker`                                | Standalone JSON stdin/stdout compiler worker                                                       | The kernel sandbox compiler supervisor and the packaged-worker smoke test |
| `./builtins`                              | `compileBuiltInSandboxEntry` and `compileSandboxPackageEntries`                                    | Built-in compiler tests and backend tooling                               |
| `./platform`                              | `pluginBackendCompilerPlatformLayer`, the Bun file system and Vite build services compiles require | Entrypoints and test harnesses that run compiles                          |
| `./plugins`                               | `compilePluginSandboxEntries`, `compilePluginSandboxSourceEntries`, and entry-path helpers         | Kernel source-zero generation and sandbox runner tests                    |
| `./plugin-manifest`                       | `derivePluginSandboxScripts` and `compilePluginManifestScripts`                                    | Local `ryot plugin build` and compiler tests                              |
| `./protocol`, `./diagnostics`, `./limits` | Worker wire types, diagnostics, and shared limits                                                  | Kernel supervisors, runtime services, and CLI code                        |
| `./runtime-build/*`                       | Trusted dependency registry, payload, source walking, and process capture                          | Kernel build and server runtime-image verification                        |

Compile functions require `FileSystem` and `ViteBuildService`; callers provide
`pluginBackendCompilerPlatformLayer` at their entrypoint. Standalone user scripts enter through `./worker`. Built-ins and plugin manifest scripts use the same
semantic and Vite Sandbox ESM build stages, but retain their separate public APIs and metadata checks.

## Build Pipeline

The compiler creates a TypeScript 7 no-emit project, inspects each entry's import policy and
definition shape, and then reports bounded semantic diagnostics. Only inspected entries reach
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
automation `inputProjection` or provider `searchOptionsSchema`; capabilities and execution
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

The parent supervisor creates a UUID job directory, passes its path and job ID to the worker, and
removes that directory with scoped acquire/use/release cleanup after success, failure, cancellation,
timeout, or forced termination. The worker is run with no orphan processes and is killed on cleanup.

Compiler limits are two concurrent jobs, a 5-second timeout, 384 MiB sampled Linux process-tree
memory, 256 KiB source, 1 MiB compiled JavaScript, 100 diagnostics, and 256 KiB diagnostic output.
The supervisor sets the native TypeScript child's `GOMEMLIMIT` to half the process-tree budget
(192 MiB), leaving room for the Bun worker, bundling, and mapped pages. This is a soft Go GC budget;
the parent still kills the worker when the full process tree exceeds the hard memory limit.
