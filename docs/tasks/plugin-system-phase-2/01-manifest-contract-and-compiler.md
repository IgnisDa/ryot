# Manifest Contract and Compiler Extension

**Parent Plan:** [Plugin System — Phase 2](./README.md)

**Type:** AFK

**Status:** todo

## Before you start

Read `docs/plans/plugin-system/00-overview.md` and
`docs/plans/plugin-system/02-phase-2-plugin-contract-and-loader.md` in full before writing any
code. They are the authoritative spec; this task file only frames the slice. Honor the plan
markers: `[DECIDED]` is fixed, `[RECOMMENDED]` is the default (deviate only with recorded
evidence), `[IMPLEMENTER-DECIDES]` is yours to settle and record in the plan file. Per
`AGENTS.md`, launch an `explore` subagent to find existing patterns before writing — the
dependency-free discipline of `@ryot/query-engine`, the `Bun.build` path in
`libs/sandbox-compiler` (`compiler-bundle.ts`), and its runtime invocation in
`apps/app-backend/src/modules/sandbox/compiler.ts`.

## What to build

The two additive infrastructure pieces the loader will consume, with no kernel wiring yet:

1. **`libs/plugin-kit`** — a new dependency-light workspace lib exporting the plugin manifest
   types and a typed, `as const`-friendly `definePlugin` builder, plus `AppSchema` re-exports.
   The manifest carries exactly the v1 sections enumerated in plan §1 (metadata, entitySchemas
   incl. nested eventSchemas, relationshipSchemas, signalSchemas, trackers, savedViews,
   scripts, bindings) and **no more** — the Phase 3 sections (`crons`, `operations`,
   `workflows`, `capabilities`) must not be added (cross-phase invariant 3). Version is a
   display/change-detection string; there is no inter-plugin dependency mechanism.
2. **`libs/sandbox-compiler` extension** — given a package root and the manifest's script
   entries, compile each entry point through the existing `Bun.build` bundling path with the
   same approved-dependency enforcement and diagnostics user scripts get today. Reuse one
   worker session across N scripts (not per-script spawn), and produce deterministic output
   ordering so content hashes are stable (this stability is what Phase 3 workflow pinning
   depends on — Decision 12).

Multi-file authoring must work: a script entry point may import from a package-local `shared/`
directory and compile into one bundled module. Do not wire either piece into the kernel boot,
ingestion, or registry — that is task 02 onward. This slice is complete when both compile,
have unit coverage, and the gate is green.

See plan §1 (manifest contract, placement rationale) and §3 (compiler extension) for the full
spec. Do not restate or re-derive it.

## Acceptance criteria

- [ ] `libs/plugin-kit` exports the manifest types and `definePlugin` builder with exactly the
      plan §1 v1 sections; no Phase 3 sections are present (cross-phase invariant 3)
- [ ] `libs/plugin-kit` stays dependency-light (types + `AppSchema` re-exports + builder), with
      no kernel-internal imports (plan §1 placement rationale)
- [ ] `libs/sandbox-compiler` compiles a multi-file fixture plugin package (script importing
      from `shared/`) through the existing bundling path with existing diagnostics/approved-dep
      enforcement
- [ ] Compiling N scripts reuses one worker session and produces deterministic, hash-stable
      output ordering (plan §3)
- [ ] Unit tests cover manifest typing/build and multi-file bundling; `bun turbo
    --filter=@ryot/app-backend check` and the affected package unit tests pass (cross-phase
      invariant 1)
- [ ] Any `[IMPLEMENTER-DECIDES]`/`[RECOMMENDED]` deviations are recorded in the Phase 2 plan
      file

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 5
- User story 8
