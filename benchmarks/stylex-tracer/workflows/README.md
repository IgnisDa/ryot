# StyleX tracer workflow evidence

These opt-in scripts keep editing, invalidation, and relocation evidence separate from the performance
benchmark. Run them only against disposable copies because the HMR and invalidation checks temporarily
edit trusted StyleX tracer sources.

## Relocated builds

Create two physical copies of the same frozen integrated tree without `.git`, `node_modules`, `dist`,
`.turbo`, or prior benchmark results. Run `bun install --frozen-lockfile` independently in each copy,
then run:

```sh
STYLEX_TRACER_EVIDENCE="$PWD/benchmarks/stylex-tracer/workflows/relocation-evidence.json" \
  bun benchmarks/stylex-tracer/workflows/compare-roots.ts /absolute/root-a /absolute/root-b
```

Each fresh Bun process resolves compiler, SDK, plugin, StyleX, and Tailwind inputs from its supplied
root. The evidence compares every artifact file by name, content type, size, and SHA-256, including
`index.html`, plus each canonical source archive and dependency fingerprint.

## Kernel Vite edit cycle

The dedicated E2E setup starts a real backend on port 3000 and a Vite development client on port 3005.
Both ports must be free. The supplied root must have its own installed dependencies.

```sh
RUN_STYLEX_TRACER_E2E=1 \
RUN_STYLEX_TRACER_HMR_E2E=1 \
STYLEX_TRACER_HMR_ROOT=/absolute/disposable-root \
STYLEX_TRACER_HMR_EVIDENCE="$PWD/benchmarks/stylex-tracer/workflows/hmr-evidence.json" \
  bun --bun run --cwd e2e vitest run 'src/browser/stylex-tracer-hmr.test.ts'
```

The test always restores both edited files through an Effect finalizer. It classifies updates from
computed styles, retained DOM and React state, and document-load count. Type feedback comes from the
scoped TypeScript checker, not Vite.

## Dependency lifetime

After building the canonical tracer archive in a disposable root, run:

```sh
STYLEX_TRACER_EVIDENCE="$PWD/benchmarks/stylex-tracer/workflows/invalidation-evidence.json" \
  bun benchmarks/stylex-tracer/workflows/invalidation-lifecycle.ts /absolute/disposable-root
```

This keeps archive bytes fixed while compiling A twice, editing a trusted token to B, compiling B
twice in the same process, recreating the process for B, and restoring A in a third process. It proves
only compiler module lifetime and deterministic compilation. Backend persistent preparation and
repository-cache reuse are recorded as `NOT RUN`; this workflow must not be cited as that evidence.
