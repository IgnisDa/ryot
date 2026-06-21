# Embedded Kernel Scripts And Architecture Checks

**Parent Plan:** [Kernel Assembly](./README.md)

**Status:** done

## What to build

Remove the last two pieces of repository-shaped path arithmetic and retire the purity checker whose guarantee is now structural. Follow the parent plan's Kernel Sandbox Scripts and Architecture Checks decisions.

Embed kernel sandbox script sources at build time into a generated module, using the same technique already used to embed the generated Deno runner source. The kernel then stops resolving those scripts by walking upward from the bundled output location, and the Dockerfile stops copying them into an absolute root path. Keep the existing verification that a compiled kernel script's manifest matches its declared metadata.

Delete the term-scanning purity checker, its domain-vocabulary derivation, its allowlist, and their tests. The guarantee they approximated is now structural: after Task 03 the kernel package cannot resolve a plugin, which is stronger than any check that reads source text.

Preserve the two checks that ran inside the purity entry point but have nothing to do with domain vocabulary: runtime module cycle detection and duplicate service-layer detection. Move them under a new architecture check entry point and point the kernel's check script at it. Their existing tests move with them.

## Acceptance criteria

- [x] Kernel sandbox script sources are embedded at build time and are not read from the filesystem at runtime.
- [x] The kernel resolves no path by walking upward from its bundled output location.
- [x] The Dockerfile no longer copies kernel scripts into an absolute root path.
- [x] Compiled kernel scripts are still verified against their declared metadata.
- [x] The purity checker, its vocabulary derivation, its allowlist, and their tests are deleted, with no replacement text scanner.
- [x] Runtime module cycle detection and duplicate service-layer detection run from a new architecture check entry point, with their tests intact.
- [x] The kernel's check script runs the architecture check and no longer references purity.
- [x] Repository check and test tasks pass.

## Implementation Notes

- Extended the existing sandbox runner generation step to emit an ignored `kernel-scripts.generated.ts` source map. Kernel boot now compiles the embedded map and performs no filesystem lookup for kernel scripts, while retaining the existing compiled-manifest metadata comparison.
- The generator and development watcher include both Deno runner and kernel script inputs. Generated entry keys use canonical `/` separators so they match declared script entries on every platform.
- Removed the Dockerfile copy to `/src/modules/definition-registry/kernel-scripts`; the server bundle now carries the required sources.
- Deleted the purity scanner, vocabulary derivation, and scanner tests. The replacement `architecture:check` entry point preserves the same production source roots for duplicate service-layer detection and continues to run runtime module cycle detection with both existing test files intact.
- `bun turbo --filter=@ryot/kernel-backend check`, `bun turbo --filter=@ryot/kernel-backend test`, and `bun turbo --filter=@ryot/server build` pass.
- The affected end-to-end files `kernel/system/plugin-boot`, `kernel/plugins/system-plugin-reconciliation`, and `kernel/definitions/definitions` pass together (9 tests).
