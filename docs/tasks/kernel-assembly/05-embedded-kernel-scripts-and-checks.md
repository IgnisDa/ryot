# Embedded Kernel Scripts And Architecture Checks

**Parent Plan:** [Kernel Assembly](./README.md)

**Status:** pending

## What to build

Remove the last two pieces of repository-shaped path arithmetic and retire the purity checker whose guarantee is now structural. Follow the parent plan's Kernel Sandbox Scripts and Architecture Checks decisions.

Embed kernel sandbox script sources at build time into a generated module, using the same technique already used to embed the generated Deno runner source. The kernel then stops resolving those scripts by walking upward from the bundled output location, and the Dockerfile stops copying them into an absolute root path. Keep the existing verification that a compiled kernel script's manifest matches its declared metadata.

Delete the term-scanning purity checker, its domain-vocabulary derivation, its allowlist, and their tests. The guarantee they approximated is now structural: after Task 03 the kernel package cannot resolve a plugin, which is stronger than any check that reads source text.

Preserve the two checks that ran inside the purity entry point but have nothing to do with domain vocabulary: runtime module cycle detection and duplicate service-layer detection. Move them under a new architecture check entry point and point the kernel's check script at it. Their existing tests move with them.

## Acceptance criteria

- [ ] Kernel sandbox script sources are embedded at build time and are not read from the filesystem at runtime.
- [ ] The kernel resolves no path by walking upward from its bundled output location.
- [ ] The Dockerfile no longer copies kernel scripts into an absolute root path.
- [ ] Compiled kernel scripts are still verified against their declared metadata.
- [ ] The purity checker, its vocabulary derivation, its allowlist, and their tests are deleted, with no replacement text scanner.
- [ ] Runtime module cycle detection and duplicate service-layer detection run from a new architecture check entry point, with their tests intact.
- [ ] The kernel's check script runs the architecture check and no longer references purity.
- [ ] Repository check and test tasks pass.
