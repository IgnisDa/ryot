# Ryot StyleX follow-up tracer report

**Date:** 2026-09-09  
**Decision:** **INVESTIGATE FURTHER**  
**Cutover:** **NOT AUTHORIZED; NOT STARTED**  
**Commit:** No commit was made for this follow-up work.

## Executive decision

The follow-up closes several gaps from the initial tracer, but it does not justify a Tailwind cutover.
The prescribed StyleX convention is now enforced at the archived-source boundary, the real kernel
edit cycle is state-preserving HMR, independently installed physical roots produce byte-identical
archives and artifacts, and the production-built kernel passed Chromium and Playwright WebKit
behavior checks. The benchmark also identifies TypeScript semantic checking as the dominant measured
span for both variants and confirms that the StyleX fixture remains materially slower and more
resource-intensive in this setup.

The dependency-lifetime result is intentionally mixed. The first direct lifecycle exercise found that
a running compiler module retained its startup fingerprint after a trusted token changed. That result
was **FAIL** for same-process invalidation and could have associated a fresh identity with stale loaded
source. The implementation now detects a startup/source mismatch and fails with
`RYOT_CLIENT_STYLEX_RESTART_REQUIRED`; a fresh compiler process then creates a new immutable artifact
and deterministically reuses that version. This explicit restart workflow is **PASS** for the bounded
tracer contract, but it is not live invalidation. More importantly, preparation and reuse through a
running backend plus its persistent repository cache across that restart is **NOT RUN**.

The permanent integration would include custom authoring validation, bounded source materialization,
Babel StyleX transformation, rule extraction, broad dependency fingerprinting, and their tests and
instrumentation. That compiler validation and instrumentation have maintenance cost, and measured
worker/process resource cost needs explicit acceptance. The smallest remaining decision evidence is a
real backend prepare/reuse sequence across the required compiler/backend restart, followed by an
engineering decision on the validator's maintenance burden and the measured latency/RSS envelope.

| Decision gate                                   | Status                | Finding                                                                                                                                                 |
| ----------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Practical enforced authoring                    | **PASS**              | The real trial sources use one checked convention; archive preflight rejects omission and noncanonical access.                                          |
| Honest CSS guarantee                            | **PASS**              | Property names, selected typed values, tokens, overrides, and static expressions are checked; arbitrary strings and visual correctness are not claimed. |
| Kernel shared-source edit cycle                 | **PASS**              | Real Vite updates were state-preserving HMR with no document loads and retained field, progress, dialog, and marker state.                              |
| Same-process trusted dependency invalidation    | **FAIL**              | Initial evidence proved startup identity was stale after source B was written. This behavior is now blocked, not made live.                             |
| Explicit dependency restart workflow            | **PASS**              | New processes compiled B, reused B, restored A, and reproduced A's identity and bytes while archive bytes stayed fixed.                                 |
| Backend persistent prepare/reuse across restart | **NOT RUN**           | The lifecycle script calls the compiler directly and does not issue `ClientPages` prepare requests or inspect repository rows.                          |
| True two-root reproducibility                   | **PASS**              | Two physical roots with independent installs and contained resolution produced equal identities, archives, and all artifact files.                      |
| Production Chromium and WebKit behavior         | **PASS**              | Both Playwright engines exercised the production-built kernel and archived plugin. This is not native Safari or device certification.                   |
| Resource attribution                            | **PASS** with caveats | Opt-in spans, raw samples, process topology, and RSS observations exist; library-level CPU/memory attribution remains unresolved.                       |
| Tailwind cutover                                | **OUT OF SCOPE**      | No broad migration, engine removal, product rewrite, or architecture cutover was performed.                                                             |

## Authority and revisions

Current source and generated files are the authority for this report. The earlier
[`ryot-stylex-tracer-report.md`](ryot-stylex-tracer-report.md) is retained as historical evidence only.
Its results are not treated as proof of current behavior.

| Item                                           | Value                                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Follow-up baseline and current `HEAD`          | `1fc9e0490c2e871270558fe3783eb52205d1a49b` (`chore: add followup plan`, 2026-09-09T08:00:00+05:30)        |
| Initial tracer parent requested for comparison | `4c312ef838bf7bdc38896644f262869750f88d9d` (`feat: add initial stylex tracer`, 2026-09-09T07:47:05+05:30) |
| Historical pre-tracer attribution base         | `5228cc84a29d98283800f90b39434825a407f51a`                                                                |
| Commits after follow-up baseline               | None                                                                                                      |
| Platform                                       | Mac16,12, arm64, 10 logical CPUs, 17,179,869,184 bytes RAM; macOS 26.3.1 (25D2128), Darwin 25.3.0         |
| Bun                                            | 1.4.0, revision `34cbb9a40b4bd1bd767d134a7065e66c2432a676`                                                |
| Node observed during report finalization       | v24.0.0                                                                                                   |
| StyleX runtime/Babel plugin                    | 0.19.0 / 0.19.0                                                                                           |
| Tailwind benchmark dependency                  | 4.3.0                                                                                                     |
| TypeScript                                     | 7.0.2                                                                                                     |
| Package manager declaration                    | `bun@1.4.0`                                                                                               |
| `bun.lock` Git blob                            | `004ae710172a43f750ad150cbb6d772ee8df7d72`                                                                |
| `bun.lock` SHA-256                             | `ca94b1a8fd8200c844df0ac0960ccebcff5df296e912f7f8392c2bc219eade99`                                        |
| Benchmark dirty-tree manifest                  | `df35dc2ed709547b3550f3ec01e1efb4abb56d2da21a876405210ecaec4b1ec9`, stable during measurement             |
| Production source manifest                     | `c294b63b6eddb95405119a9f822a9d7dfae489f3d92f095407b5f8f4a636db72`                                        |

The benchmark uses `HEAD` as the revision label while separately hashing graph inputs and dirty files.
The tested implementation is therefore `1fc9e049...` plus the recorded dirty content, not the clean
commit alone. Generated evidence dates are 2026-09-09: relocation at 03:56:25Z, invalidation at
04:30:00Z, production browser at 04:34:04Z, and HMR epoch `1788928474103`.

## Dirty content manifest

At report start, `git status --short --untracked-files=all` recorded the following. The two report
documentation changes are additional finalization changes and are not inputs to the generated
benchmark manifest.

```text
M  benchmarks/stylex-tracer/README.md
M  benchmarks/stylex-tracer/benchmark.ts
M  benchmarks/stylex-tracer/results/result.json
M  benchmarks/stylex-tracer/results/result.md
M  benchmarks/stylex-tracer/run.ts
M  benchmarks/stylex-tracer/worker.ts
M  e2e/README.md
M  e2e/global-setup.ts
M  e2e/src/browser/stylex-tracer.test.ts
M  packages/cli/tests/fixtures/stylex-tracer/client/tracer.tsx
M  packages/client-plugin-compiler/README.md
M  packages/client-plugin-compiler/src/bundle.ts
M  packages/client-plugin-compiler/src/compile.ts
M  packages/client-plugin-compiler/src/index.ts
M  packages/client-plugin-compiler/src/protocol.ts
M  packages/client-plugin-compiler/src/styles.ts
M  packages/client-plugin-compiler/src/stylex-tracer.test.ts
M  packages/client-plugin-compiler/src/stylex-tracer.ts
M  packages/client-plugin-compiler/src/worker.ts
M  packages/client-ui-sdk/src/stylex-tracer/controls.tsx
M  packages/client-ui-sdk/src/stylex-tracer/panel.tsx
M  plugins/stylex-tracer/client/page.tsx
?? benchmarks/stylex-tracer/alternating-worker.ts
?? benchmarks/stylex-tracer/boundary-worker.ts
?? benchmarks/stylex-tracer/inventory.ts
?? benchmarks/stylex-tracer/workflows/README.md
?? benchmarks/stylex-tracer/workflows/compare-roots.ts
?? benchmarks/stylex-tracer/workflows/hmr-evidence.json
?? benchmarks/stylex-tracer/workflows/invalidation-evidence.json
?? benchmarks/stylex-tracer/workflows/invalidation-lifecycle.ts
?? benchmarks/stylex-tracer/workflows/invalidation-worker.ts
?? benchmarks/stylex-tracer/workflows/production-browser-evidence.json
?? benchmarks/stylex-tracer/workflows/relocation-evidence.json
?? benchmarks/stylex-tracer/workflows/root-build.ts
?? e2e/src/browser/stylex-tracer-hmr.test.ts
?? packages/client-plugin-compiler/src/instrumentation.ts
```

Against `HEAD`, the 22 tracked pre-report files contain 3,848 additions and 1,325 deletions. This is a
worktree diff, not a claimed net production integration size. The source-backed accounting below is
the appropriate responsibility inventory.

## Implementation changes and rationale

### Authoring boundary

**Status: PASS.** `packages/client-plugin-compiler/src/stylex-tracer.ts` now parses original source and
enforces one narrow, inspectable convention before Babel transformation. It requires a namespace
StyleX import, direct noncomputed `stylex.create({ ... })`, `satisfies stylex.CSSProperties` on static
declarations and conditional leaves, and an explicit `stylex.CSSProperties` return type on dynamic
styles. The AST walk is bounded to 100,000 nodes. The compiler validates all eligible archived client
sources, including unreachable files, and validates trusted tracer sources too.

The real controls, panel, plugin page, and CLI fixture use this convention. Conditions were separated
into checked leaves where needed, and the dynamic progress/safe-area functions gained explicit return
types. This change is necessary because StyleX 0.19.0 plain object inference accepts unknown property
names and unconstrained strings. It is not presented as a general CSS validator.

`packages/client-plugin-compiler/src/compile.ts` runs original import-policy preflight and convention
preflight before bundling. A failure returns diagnostics and no artifact. There is no Tailwind
fallback. Existing import, source/asset limit, temporary cleanup, and CSS-isolation behavior remains
covered.

### Dependency generation guard

**Status: PASS for explicit restart; FAIL for live invalidation.** The StyleX adapter snapshots trusted
source hashes at compiler module startup. Each compilation reads the current trusted source set and
compares it with that startup snapshot. A mismatch returns
`RYOT_CLIENT_STYLEX_RESTART_REQUIRED` before bundling. This prevents a running generation from
emitting source B with fingerprint A, or assigning a newly computed identity to stale loaded bytes.

This is deliberately a guard, not a watcher or general plugin HMR service. The supported author action
is to stop the process that loaded `@ryot-app/client-plugin-compiler`, restart it, and rebuild or repeat
preparation. CLI `bun run --cwd plugins/stylex-tracer build` is naturally a fresh process. For a
running server, stop it and run `RYOT_STYLEX_TRACER=1 bun run --cwd apps/server src/main.ts` again
before preparing the page.

### Instrumentation and evidence runners

**Status: PASS with maintenance caveats.** `instrumentation.ts` and optional protocol fields carry
benchmark-only span/counter evidence through direct and supervised compiler paths. The hooks are
inactive unless requested; their values do not enter emitted assets or artifact identity. Bundle,
StyleX transform, validation, reads, semantic checking, CSS, assets, hashing, worker imports, and total
time are observed with monotonic timestamps. The protocol remains format/API/compiler/bridge version
1 because these optional fields are internal coordinated benchmark data, not plugin-controlled wire
capabilities.

The benchmark now separates uninstrumented totals from instrumented runs, alternates five warm samples
per variant after an unreported warmup, records input manifests and raw/compressed sizes, and exercises
the configured semaphore/worker boundary with one and two uncached builds. Separate workflow runners
own HMR, dependency lifetime, true relocation, and production-browser evidence.

### E2E attestation

**Status: PASS.** E2E setup now distinguishes Vite development from production assets. Production
mode hashes the built and served `index.html` and fails if they differ. The production suite records a
source manifest, backend PID, engine versions, user agents, and covered assertions. The HMR suite uses
a disposable root, real backend and Vite server, computed styles, DOM identity, state, and document
load counts; finalizers restore edited files.

## Authoring contract

The prescribed source shape is documented in
`packages/client-plugin-compiler/README.md:57-105`. The real source examples are
`packages/client-ui-sdk/src/stylex-tracer/controls.tsx`, `panel.tsx`, and
`plugins/stylex-tracer/client/page.tsx`. Archive-boundary tests are in
`packages/client-plugin-compiler/src/stylex-tracer.test.ts:55-590`.

### Plain versus prescribed matrix

“Repository check” means TypeScript as reached by the package check. “Archive compiler” includes
Ryot preflight, TypeScript semantic checking, and the upstream StyleX transform. Logical positions
below are the fixture positions asserted by current tests; trusted-source HMR has its own real path.

| Case                                                          | Plain authoring result                                                                                                                      | Prescribed authoring result                                                                                                                                 | Repository check                                                 | Archive compiler                                                                      | Detector/code and logical position                                                       | Status              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------- |
| `colour` instead of `color`                                   | Plain inference does not provide the intended property guarantee. Archive preflight rejects omission of the convention.                     | `{ colour: ... } satisfies stylex.CSSProperties` fails. Valid `color` compiles.                                                                             | Prescribed form fails `TS2561`.                                  | Plain fails `RYOT_CLIENT_STYLEX_CONVENTION`; prescribed fails `TS2561`.               | Plain `client/view.tsx:2:38`; prescribed `client/view.tsx:4` in the matrix fixture.      | **PASS**            |
| `position: "absolut"`                                         | Plain inference accepts an unconstrained string type; archive preflight rejects the missing convention.                                     | `satisfies stylex.CSSProperties` fails while `absolute` compiles.                                                                                           | Prescribed form fails `TS2820`.                                  | Plain fails `RYOT_CLIENT_STYLEX_CONVENTION`; prescribed fails `TS2820`.               | Plain `client/view.tsx:2:38`; prescribed `client/view.tsx:4`.                            | **PASS**            |
| Missing shared token member                                   | TypeScript member access is invalid independent of CSS annotation, but plain declarations are not accepted by the archive contract.         | Checked declaration fails on `tracerTokens.missing`.                                                                                                        | `TS2339`.                                                        | `TS2339`, no artifact.                                                                | `client/view.tsx:3`.                                                                     | **PASS**            |
| Missing archive-local token member                            | Same qualification as shared tokens. Missing/escaping module paths remain import-policy errors.                                             | Checked declaration fails on `localTokens.missing`.                                                                                                         | `TS2339`; missing module is an import error.                     | `TS2339`, or positioned `RYOT_CLIENT_IMPORT` for `./missing-tokens.stylex`/escape.    | Member: `client/view.tsx:3`; import: `client/view.tsx:2` with asserted specifier column. | **PASS**            |
| Forbidden button `position` override                          | Component `StyleXStyles<Pick<...>>` contract rejects the resulting style; plain declaration itself still lacks the required authoring form. | Checked declaration plus narrow `xstyle` fails; real color/background override passes browser and type checks.                                              | TypeScript diagnostic in authored source.                        | TS-prefixed diagnostic, no artifact.                                                  | `client/view.tsx`, override fixture lines 2-3. Exact TS number is not asserted.          | **PASS**            |
| Hover/focus/invalid condition                                 | A flat unannotated condition is rejected by convention preflight.                                                                           | Each pseudo-condition declaration leaf uses `satisfies stylex.CSSProperties`; real hover, focus-visible, disabled, placeholder, and invalid states compile. | Pass for valid real sources.                                     | Emits conditional rules.                                                              | Plain condition omission: `RYOT_CLIENT_STYLEX_CONVENTION` at `client/view.tsx:2:38`.     | **PASS**            |
| Media/reduced-motion condition                                | Unannotated nested declaration is rejected by convention preflight.                                                                         | Media wrapper checks its declaration leaf; reduced-motion CSS is emitted and exercised in browser coverage.                                                 | Pass.                                                            | Emits `prefers-reduced-motion`.                                                       | Omission: `RYOT_CLIENT_STYLEX_CONVENTION`; valid fixture at `client/view.tsx:67`.        | **PASS**            |
| Typed dynamic progress                                        | `(width) => ({ width })` is rejected because no checked return contract exists.                                                             | `(width: string): stylex.CSSProperties => ({ width })` passes; runtime custom property changes width without new style rules.                               | Pass.                                                            | Emits `width:var(...)`; production browser interaction passes.                        | Omission: `RYOT_CLIENT_STYLEX_CONVENTION` at `client/view.tsx:2:38`.                     | **PASS**            |
| Shared and local tokens                                       | Valid members from `tracerTokens` and archive-local `localTokens` compile and extract.                                                      | Checked declarations emit both token values.                                                                                                                | Pass.                                                            | CSS includes shared `#25221d` and local `#13579b` fixture values.                     | Compiler extraction test lines 55-98.                                                    | **PASS**            |
| CSS custom property and `calc(...)`                           | Upstream types intentionally allow flexible strings. They are not semantically parsed by Ryot.                                              | `maxWidth: "calc(100% - 48px)"` passes and is emitted; dynamic width uses a runtime custom property.                                                        | Pass.                                                            | Pass and emitted CSS contains the expected expression.                                | Compiler extraction test `client/view.tsx:6` logical fixture line.                       | **PASS** with limit |
| Unsupported shorthand `border`                                | Plain source would still be rejected for convention omission first.                                                                         | Checked `border` reaches upstream validation and fails; longhands compile.                                                                                  | `CSSProperties` alone does not supply this final transform rule. | `RYOT_CLIENT_STYLEX`, logical `client/view.tsx`, positioned by Babel.                 | Fixture lines 2-5; exact line/column is asserted positive, not fixed.                    | **PASS**            |
| Unsupported compile-time expression                           | If prescribed, it passes the shape check but fails the upstream static transform.                                                           | `globalThis.crypto.randomUUID()` as a style value fails and no artifact is produced.                                                                        | TypeScript is not the detector for static evaluability.          | `RYOT_CLIENT_STYLEX`; Vite overlay identifies `controls.tsx:167` in the HMR exercise. | Trusted logical source plus Vite physical path in HMR evidence.                          | **PASS**            |
| Omitted convention in unreachable source                      | Plain declaration could otherwise escape normal reachability-based checks.                                                                  | Not applicable; omission is the test.                                                                                                                       | A package check may not compile a synthetic archive file.        | `RYOT_CLIENT_STYLEX_CONVENTION`.                                                      | `client/unreachable.ts:2`.                                                               | **PASS**            |
| Aliased/computed/optional/named/default/dynamic StyleX access | Noncanonical forms could bypass the narrow recognizer.                                                                                      | Namespace import plus direct noncomputed call is required.                                                                                                  | TypeScript can accept several noncanonical forms.                | Twenty forms fail `RYOT_CLIENT_STYLEX_CONVENTION` at asserted logical positions.      | `client/view.tsx`, lines 1-2 and case-specific columns.                                  | **PASS**            |

### Guarantee and limits

**PASS:** The convention checks ordinary property names and typed constrained values through
`stylex.CSSProperties`; token member existence and restricted component overrides through TypeScript;
static expression and property restrictions through the installed StyleX transform; and import/config
security through Ryot preflight. Valid pseudo conditions, media conditions, typed dynamic functions,
shared/archive-local tokens, CSS custom properties, and `calc(...)` remain practical.

**FAIL if interpreted as universal CSS validation:** many upstream CSS property values are intentionally
typed as `string`. Ryot does not parse those strings, prove browser support, detect every invalid CSS
combination, or prove visual correctness. `calc(...)`, custom-property expressions, transition strings,
font families, grid templates, and similar flexible values can be syntactically checked only to the
extent provided by upstream TypeScript and StyleX. Intentional `any`, unsafe casts, and suppressions are
not made safe by this convention. Original import-policy preflight still prevents suppression from
authorizing imports.

**Maintenance concern:** the convention detector probes Babel AST shapes and intentionally bans many
otherwise valid JavaScript access patterns to keep enforcement tractable. Parser or upstream API
changes require review of `validateStylexAuthoringConvention`. This bespoke rule is a decision cost,
not free type safety.

## Kernel Vite edit cycle

**Status: PASS.** `hmr-evidence.json` records a real opt-in Vite development client and backend in the
disposable root `/.../stylex-b2-root-a`, backend PID 77843 and Vite PID 77926. The classification is
`state-preserving-hmr`, not reload and not manual restart.

| Sequential observation          | Evidence                                                                                                                                 | Status   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Initial interactive state       | Field set to `HMR state`, progress 42, details dialog open, DOM marker retained.                                                         | **PASS** |
| Shared control declaration edit | Computed declaration changed to `5px`.                                                                                                   | **PASS** |
| Imported shared token edit      | Computed token color changed to `rgb(0, 170, 68)` while the UI remained mounted.                                                         | **PASS** |
| Declaration removal             | Observable fallback became `0px`; stale CSS did not win.                                                                                 | **PASS** |
| Invalid compile-time edit       | Vite displayed the `@stylexjs/unplugin` error overlay for a non-static call at `controls.tsx:167`; prior UI remained present.            | **PASS** |
| Scoped type error               | The separate TypeScript checker exited 1 with `TS2561` for `colour` at `controls.tsx:166`. Vite itself is not claimed to run this check. | **PASS** |
| Restore and recovery            | Vite accepted the restored module; dialog, field, progress, marker, and original computed styles recovered.                              | **PASS** |
| Reload classification           | `documentLoadsDuringEdits` was 0.                                                                                                        | **PASS** |
| Cleanup                         | Effect finalizer restores both mutated files. Current source contains no test mutation.                                                  | **PASS** |

## Dependency lifetime and immutable artifacts

The canonical archive SHA-256 stayed
`079d663520677d4e70a89b0b39cebba6eff14991e3f3a45dc41a3a3851cf1bf6` before and after the source
mutation. Therefore the identity change below comes from the trusted dependency closure, not changed
plugin bytes.

| Generation                    |   PID | Dependency fingerprint                                             | Artifact hash                                                      | CSS SHA-256                                                        | B present | Result                                                                   |
| ----------------------------- | ----: | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------ |
| A1                            | 74664 | `b59edd82abf4396a3bf5b548eba15ddc84f691861fe8ed2b4831a2a40deca871` | `1bd0663be076f1c50ff540ac155da9767bd88341f1d4c39b83df9c78c90a8056` | `b5d4c96a1cb58e1d45df96e2f7c3ea4af1e162f3aea8e130871b695718831a92` | No        | **PASS**                                                                 |
| A2 reuse                      | 74664 | Same as A1                                                         | Same as A1                                                         | Same as A1                                                         | No        | **PASS** deterministic reuse                                             |
| After writing B, same process | 74664 | Still A                                                            | No valid B artifact accepted by current guard                      | Not accepted                                                       | No        | **FAIL** for live identity; current expected restart-required diagnostic |
| Restarted B1                  | 74703 | `97aabe9345c04295a0108dfabdc07c57e4e52fcb4b5a5a8e816d8a157437166c` | `e25d8d5f8f7fbcdf28f79cef76151b9aee252002efc0f09ff8c9c61a80aaf359` | `c6b952bf26e1139ca260c890590dbc80ecbfd0e95c5b00b2c8ed305b4b30443d` | Yes       | **PASS** new immutable artifact                                          |
| Restarted B2 reuse            | 74703 | Same as B1                                                         | Same as B1                                                         | Same as B1                                                         | Yes       | **PASS** deterministic reuse                                             |
| Restored A                    | 74726 | Original A                                                         | Original A                                                         | Original A                                                         | No        | **PASS** deterministic restoration                                       |

The stale same-process identity was the initial **FAIL** that led to the restart guard. The guard's
focused test injects changed trusted token bytes and expects
`RYOT_CLIENT_STYLEX_RESTART_REQUIRED` on `trusted/stylex-tracer/tokens.stylex.ts`. Old in-flight work
continues to be keyed by graph hash; build-local rules and temporary files are isolated and cleaned on
success/failure. No artifact CSS is patched in place.

**Backend persistent prepare-cache lifecycle: NOT RUN.** Existing historical repository harness tests
exercise repository methods over a recording database interface, not this full follow-up sequence and
not PostgreSQL. `invalidation-lifecycle.ts` invokes the real compiler directly. It neither performs
backend `ClientPages` preparation nor demonstrates that persistent A and B rows are selected correctly
after the supported backend/compiler restart. This is the principal missing lifecycle evidence.

## True two-root relocation

**Status: PASS.** Two physical source roots, `/.../stylex-b2-root-a` and
`/.../stylex-b2-root-b`, were copied without `.git`, `node_modules`, prior `dist`, `.turbo`, or result
state and installed separately with the frozen lockfile. Each fresh process resolved compiler, shared
panel, tracer plugin source, Tailwind fixture, StyleX package, and Tailwind package inside its own root.
All recorded `containedInRoot` values are true. Cache roots were isolated.

Both roots record revision `1fc9e049...`, source/tree manifest
`411c2204bbba0f57af619a8c7eaf057c8505aec1b84762f57b712e20551fcc14`, content identity
`9aeea137d20066357921ddfa5685ff78c97e20a0b31ff28077afd7fd6b376fb8`, lock SHA-256
`ca94b1a8...`, API version 1, and dependency fingerprint
`b59edd82abf4396a3bf5b548eba15ddc84f691861fe8ed2b4831a2a40deca871`. Root A used isolated
`stylex-b2-cache-a`, `stylex-b2-xdg-a`, and `stylex-b2-tmp-a` roots; root B used the corresponding
`-b` roots. The equality object passes revision, tree/content identity, source manifest, root
containment, isolated caches, logical output, both source archives, and every StyleX/Tailwind artifact
file.

| Variant/file               |   Bytes | SHA-256 in root A and B                                            | Status   |
| -------------------------- | ------: | ------------------------------------------------------------------ | -------- |
| StyleX canonical archive   |   2,285 | `ba424c8d1fde363a89c92cc12945e4822c2828641c8e934e161a3381b6bdd0d8` | **PASS** |
| StyleX artifact hash       |     n/a | `1bd0663be076f1c50ff540ac155da9767bd88341f1d4c39b83df9c78c90a8056` | **PASS** |
| StyleX `plugin.js`         | 606,248 | `cc7e7cdd775090c50ccd6b2b34f72cb4624cce622bb3fd9224f8b20aeb810bba` | **PASS** |
| StyleX `plugin.css`        |  11,402 | `b5d4c96a1cb58e1d45df96e2f7c3ea4af1e162f3aea8e130871b695718831a92` | **PASS** |
| StyleX `index.html`        |     538 | `8234faa59f10dd02f89a089c88d67237559f603b07bda8b2dee1dbd2b8e273e8` | **PASS** |
| Tailwind canonical archive |   4,571 | `b2b5350b444f9b420530cdc9676342d19c093eeb59035b84c11ac3915d12ce42` | **PASS** |
| Tailwind artifact hash     |     n/a | `3d67c14e70e7ae096e1167de22d9e048ff0c6b0dfbd980dea29db922ffaae947` | **PASS** |
| Tailwind `plugin.js`       | 597,595 | `07f9602d3b1c542eb4bef6ac743970d7408f30de4fbbce6ac7251e70c7899fd5` | **PASS** |
| Tailwind `plugin.css`      |  44,586 | `f6a203637cdf1b27870a276cc5f7056cbe178473742c408bf75f1f741dd869f6` | **PASS** |
| Tailwind `index.html`      |     538 | `687c76505acda070bb6bd0ee1f629b6a0a9a78e3f9f9b961c4a63b52b5789f37` | **PASS** |

All nine font files and the SVG asset also match by name, MIME type, byte count, and SHA-256. The old
single-checkout/distinct-cwd result remains historical supplementary evidence only; it is not the basis
of this relocation pass.

## Production browser evidence

**Status: PASS with qualification.** E2E attested `assetMode: "production"`, backend PID 77178, built
and served index SHA-256 `2e344483a8899d30b329616f4e68fa2bb8318854755f0e1a58f757a16f6e3636`,
and source manifest `c294b63b...`. Chromium 151.0.7922.34 and Playwright WebKit 26.5 each covered:

- production asset attestation;
- kernel render and field/progress interaction;
- permitted override and focus behavior;
- theme change while the portal remained open;
- archived plugin artifact and extracted CSS; and
- plugin lifecycle exit and re-entry.

The suite also retains the broader initial tracer checks in the same E2E source. This follow-up did not
replace production output with Vite output. The WebKit result is engine evidence under Playwright. It
is **NOT** a native Safari application run, iOS device run, or Capacitor certification.

| Browser target               | Status                              |
| ---------------------------- | ----------------------------------- |
| Playwright Chromium on macOS | **PASS**                            |
| Playwright WebKit on macOS   | **PASS**                            |
| Native Safari application    | **NOT RUN**                         |
| Native iOS/Android devices   | **OUT OF SCOPE**                    |
| Firefox                      | **OUT OF SCOPE**                    |
| Cloudflare tunnel            | **OUT OF SCOPE** for this follow-up |

## Benchmark and resource profile

**Status: PASS with attribution caveats; no optimization was made.** The current run uses equivalent
page-graph fixtures, production compiler options, two fonts, one SVG, zero artifact cache hits, one
fresh process per variant, and a separate warm process with one discarded warmup then five alternating
samples per variant. “Fresh” means process-cold, not filesystem-cold.

### Historical versus follow-up raw measurements

The historical values come from the retained initial result and are not an isolated before/after
optimization comparison. The implementation, instrumentation, source inventory, and benchmark method
changed; filesystem, thermal state, and background load were uncontrolled.

| Variant/run         | Fresh wall ms | Warm forced samples ms                           |          Median [min, max] ms | Fresh peak RSS B |
| ------------------- | ------------: | ------------------------------------------------ | ----------------------------: | ---------------: |
| Historical StyleX   |      1,868.79 | 1,527.32, 1,524.73, 1,516.40, 1,525.59, 1,508.21 | 1,524.73 [1,508.21, 1,527.32] |      660,897,792 |
| Follow-up StyleX    |      1,978.35 | 1,615.03, 1,665.14, 1,636.48, 1,585.94, 1,659.66 | 1,636.48 [1,585.94, 1,665.14] |      652,820,480 |
| Historical Tailwind |        851.55 | 667.84, 634.97, 638.94, 634.10, 647.82           |       638.94 [634.10, 667.84] |      385,089,536 |
| Follow-up Tailwind  |        883.53 | 652.65, 674.68, 661.04, 648.43, 684.17           |       661.04 [648.43, 684.17] |      382,599,168 |

The follow-up warm median ratio is approximately 2.48x (`1636.48 / 661.04`) for StyleX versus
Tailwind in this fixture. That ratio describes this benchmark only. It does not predict an entire
product build.

### Current artifact sizes

| Variant  |     JS raw/gzip B | CSS raw/gzip B | JS+CSS raw/gzip B |         Fonts | Local assets | Full artifact | Source archive |
| -------- | ----------------: | -------------: | ----------------: | ------------: | -----------: | ------------: | -------------: |
| StyleX   | 606,248 / 188,928 | 11,402 / 4,240 | 617,650 / 193,168 | 205,324 B / 9 |    230 B / 1 |     823,742 B |        2,285 B |
| Tailwind | 597,595 / 185,327 | 44,586 / 9,853 | 642,181 / 195,180 | 205,324 B / 9 |    230 B / 1 |     848,273 B |        4,571 B |

StyleX is 24,531 raw JS+CSS bytes smaller and 2,012 gzip JS+CSS bytes smaller, while its JavaScript is
8,653 raw bytes larger and its CSS is 33,184 raw bytes smaller. The full StyleX artifact is 24,531
bytes smaller because fonts, SVG, and document size are equal.

### Measured stages

| Variant  | Exact/inclusive span                |                                        ms | Qualification                                                |
| -------- | ----------------------------------- | ----------------------------------------: | ------------------------------------------------------------ |
| StyleX   | input validation                    |                                      0.24 | exact                                                        |
| StyleX   | original-source preflight           |                                     28.98 | exact                                                        |
| StyleX   | dependency reads                    |                                      4.10 | exact enclosing read span                                    |
| StyleX   | trusted reads/materialization       |                                     14.08 | inclusive inside bundle                                      |
| StyleX   | seven StyleX transforms             | 6.21, 12.97, 1.21, 2.74, 1.37, 6.34, 8.64 | inclusive inside bundle                                      |
| StyleX   | cleanup                             |                                      0.44 | inclusive inside bundle                                      |
| StyleX   | bundle                              |                                     75.31 | inclusive; contains the four rows above plus native Bun work |
| StyleX   | TypeScript semantic check           |                                  1,556.54 | exact parent wait; work runs in a `tsc` child                |
| StyleX   | CSS emission                        |                                      1.15 | exact outer span; rule processing not separately attributed  |
| StyleX   | assets / hashing-artifact           |                               0.02 / 0.69 | exact                                                        |
| StyleX   | compilation total / residual        |                           1,667.24 / 0.20 | total inclusive; residual unresolved                         |
| Tailwind | input validation / dependency reads |                               0.23 / 4.95 | exact                                                        |
| Tailwind | bundle                              |                                     20.69 | inclusive                                                    |
| Tailwind | TypeScript semantic check           |                                    641.51 | exact parent wait; work runs in a `tsc` child                |
| Tailwind | CSS emission                        |                                     21.50 | exact outer span; scan/build not separated                   |
| Tailwind | assets / hashing-artifact           |                               0.01 / 0.70 | exact                                                        |
| Tailwind | compilation total / residual        |                             689.85 / 0.27 | total inclusive; residual unresolved                         |

The largest observed difference is the semantic-check wait, not StyleX transformation itself. The
result does not prove why the StyleX checked graph takes longer inside `tsc`, and CPU ownership is not
available from the parent wait measurement. Inclusive transform/materialization spans must not be
added to the bundle span.

### Configured process boundary and concurrency

The boundary is the real kernel `ClientPluginCompiler.layer`: semaphore concurrency 2, one supervised
`bun --smol` compiler child per request, and one `tsc` semantic-check child per compiler worker. Pair
inputs were distinct and uncached, both builds overlapped, completed, and retained isolated CSS.

| Variant  | Single wall ms | Pair wall ms | Observed overlap ms | Single/pair sampled aggregate peak RSS B | Pair process count | Status   |
| -------- | -------------: | -----------: | ------------------: | ---------------------------------------: | -----------------: | -------- |
| StyleX   |       1,981.25 |     2,146.49 |            2,122.72 |              963,248,128 / 1,775,534,080 |                  5 | **PASS** |
| Tailwind |         922.86 |     1,113.49 |            1,079.21 |              728,711,168 / 1,350,762,496 |                  5 | **PASS** |

The five observed pair processes are the orchestrator, two compiler children, and two semantic-check
children. The 5 ms `ps` sampler can miss peaks and aggregate RSS can double-count shared pages. macOS
does not expose the Linux `/proc` proportional-memory supervision used by production. `/usr/bin/time`
fresh RSS excludes the TypeScript child from the direct process high-water mark, while sampled tree RSS
uses another boundary. Per-library memory allocation and true proportional pair peak remain unresolved.

### Unresolved attribution

- **NOT RUN:** filesystem-cold measurements; caches were not flushed.
- **UNRESOLVED:** benchmark import time versus dependency-fingerprint initialization within the fresh import span.
- **UNRESOLVED:** individual dependency, trusted source, font, and package read costs.
- **UNRESOLVED:** TypeScript child CPU and allocation attribution; only parent wait and sampled process RSS are known.
- **UNRESOLVED:** native Bun bundle work after nested materialization/transforms are removed.
- **UNRESOLVED:** Tailwind scan versus build within CSS emission, and StyleX rule processing within its CSS span.
- **UNRESOLVED:** production Linux proportional memory and representative product-scale graph behavior.
- **PASS:** instrumentation did not change artifact identity, and no localized optimization was attempted without a measured, safely isolated cause.

## Permanent-cost and retain/delete inventory

The authoritative item table is generated in `benchmarks/stylex-tracer/results/result.md:66-90` from
`benchmarks/stylex-tracer/inventory.ts`. Ranges are responsibility slices, can overlap, and must not be
summed as net integration size. Historical attribution uses pre-tracer parent `5228cc84...`.

| Classification                             | Source/symbol                                                 |                Size | Responsibility                                                       | Recommendation                                                                       |
| ------------------------------------------ | ------------------------------------------------------------- | ------------------: | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Permanent StyleX                           | `stylex-tracer.ts:667-856`, `createStylexTracerBundleAdapter` | 190 lines / 6,885 B | Bounded materialization, resolution, Babel transform, rules, cleanup | Retain only after generic naming/scope review.                                       |
| Permanent StyleX                           | `stylex-tracer.ts:857-869`, `compileStylexTracerStyles`       |            13 / 594 | Rule processing, reset/fonts/marker composition                      | Retain extraction; review tracer marker/reset placement.                             |
| Permanent StyleX                           | `stylex-tracer.ts:202-437`, authoring validator/helpers       |         236 / 7,330 | AST-enforced checked declaration convention                          | Retain only if bespoke validator maintenance is accepted.                            |
| Permanent StyleX                           | `stylex-tracer.ts:60-178`, fingerprint derivation/input set   |         119 / 3,843 | Startup hash over compiler, sources, packages, runtime, lock, fonts  | Retain invalidation; redesign broad startup lifetime for adopted scope.              |
| Permanent StyleX                           | `dependencies.ts:85-96`, TS entries                           |            12 / 384 | StyleX/trusted UI semantic-check entries                             | Retain with approved public authoring surface.                                       |
| Experiment only                            | `stylex-tracer.ts:19-58`, tracer constants/options/reset      |          40 / 1,408 | Exact allowlist, tracer identity, reset/options                      | Remove tracer names/coexistence seam after decision.                                 |
| Experiment only                            | `kernel/backend/.../stylex-tracer-activation.ts:1-31`         |          31 / 1,060 | Flag and exact-slug backend activation                               | Delete after adoption or rejection.                                                  |
| Experiment only                            | kernel route `stylex-tracer-kernel.tsx:1-19`                  |            19 / 676 | Demonstration route                                                  | Delete after decision.                                                               |
| Experiment only                            | `plugins/stylex-tracer/client/page.tsx:1-86`                  |          86 / 2,680 | Archived proof adapter/local tokens                                  | Delete; not product UI.                                                              |
| General safeguard                          | `compile.ts:273-512`, input preparation                       |         240 / 8,661 | Paths, graph, limits, decoding, asset names                          | Retain independent of engine.                                                        |
| General safeguard                          | `source-imports.ts:1-173`                                     |         173 / 4,985 | Original-source import validation                                    | Retain; StyleX only extends exact policy.                                            |
| General safeguard                          | `semantic-check.ts:35-89`                                     |          55 / 1,693 | TypeScript semantic checking                                         | Retain independent of engine.                                                        |
| General safeguard                          | `compile.ts:697-821`                                          |         125 / 4,005 | Reachability, assets, hashing, document/artifact limits              | Retain independent of engine.                                                        |
| Tailwind removable in adopted client scope | `styles.ts:194-276`, `compileClientStyles`                    |          83 / 2,656 | Entry injection, scan/build, legacy theme/palette CSS                | Remove only from a future StyleX-only in-scope path; retain generic asset rewriting. |
| Tailwind removable in adopted client scope | `dependencies.ts:196-214`, ordinary branch                    |            19 / 835 | SDK scan, Tailwind entry, theme/palette reads                        | Remove only in adopted scope. Other repository consumers still require Tailwind.     |
| Candidate UI                               | `controls.tsx:1-198`                                          |         198 / 5,335 | Accessible button/text field and constrained overrides               | Retain as pattern only after API/design review.                                      |
| Candidate UI                               | `tokens.stylex.ts:1-56`                                       |          56 / 1,448 | Typed token/theme proof                                              | Retain pattern, replace demonstration token contract.                                |
| Disposable UI                              | `panel.tsx:1-318`                                             |         318 / 9,607 | Interactive panel, portal, shortcut, theme/viewport proof            | Delete after decision; behavior is demonstrative.                                    |
| Disposable UI                              | Tailwind fixture `page.tsx:1-168`                             |         168 / 5,182 | Benchmark comparison adapter                                         | Delete when evidence retention ends.                                                 |

Classification totals are: permanent StyleX 570 lines/19,036 bytes; experiment-only 176/5,824;
general safeguard 593/19,344; in-scope Tailwind-removable 102/3,491; candidate UI 254/6,783; and
disposable UI 486/14,789. These totals are analytical categories, not a quality score.

### Dependency implications

The StyleX path directly introduces `@stylexjs/stylex@0.19.0`,
`@stylexjs/babel-plugin@0.19.0`, `@stylexjs/unplugin@0.19.0`, `@babel/core@7.29.0`, syntax JSX and
TypeScript plugins at 7.28.6, and Babel declarations. Immediate transitive runtime sets include
StyleX's `css-mediaquery`, `invariant`, and `styleq`; Babel transform/traverse/type packages; StyleX
shared and resolver packages; and unplugin's browserslist/lightningcss and syntax dependencies.
Excluded clients and repository tools still use Tailwind. A scoped StyleX adoption does not imply
repository-wide Tailwind deletion.

The largest permanent obligations are the AST convention validator, trusted/archive resolution and
materialization, startup dependency closure/fingerprint lifecycle, upstream Babel transform/rule
extraction, and regression/instrumentation coverage. The current names and exact-slug gates remain
experiment machinery, not a production abstraction.

## Commands and results

Commands are listed exactly where generated evidence records them or current repository documentation
defines the exercised entry point. Disposable roots were used for source-mutating workflows.

| Command                                                                                                                                                                                                                                                                  | Result                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun turbo --filter=@ryot-app/client-plugin-compiler test`                                                                                                                                                                                                               | **PASS** for the current authoring, restart-guard, import-policy, limits, isolation, and artifact tests represented in source.                                    |
| `bun turbo --filter=@ryot-app/client-plugin-compiler check`                                                                                                                                                                                                              | **PASS** as recorded by current compiler README/source finalization.                                                                                              |
| `bun run --cwd plugins/stylex-tracer check`                                                                                                                                                                                                                              | **PASS** for the prescribed real plugin source.                                                                                                                   |
| `bun run --cwd plugins/stylex-tracer build`                                                                                                                                                                                                                              | **PASS**; fresh CLI process builds the canonical archive with `RYOT_STYLEX_TRACER=1`.                                                                             |
| `RUN_STYLEX_TRACER_E2E=1 RUN_STYLEX_TRACER_HMR_E2E=1 STYLEX_TRACER_HMR_ROOT=/absolute/disposable-root STYLEX_TRACER_HMR_EVIDENCE="$PWD/benchmarks/stylex-tracer/workflows/hmr-evidence.json" bun --bun run --cwd e2e vitest run 'src/browser/stylex-tracer-hmr.test.ts'` | **PASS**; state-preserving HMR and checker recovery recorded.                                                                                                     |
| `STYLEX_TRACER_EVIDENCE="$PWD/benchmarks/stylex-tracer/workflows/invalidation-evidence.json" bun benchmarks/stylex-tracer/workflows/invalidation-lifecycle.ts /absolute/disposable-root`                                                                                 | **PASS** for restart guard/module recreation and deterministic A/B/A compilation; **FAIL** historical same-process invalidation; backend persistence **NOT RUN**. |
| `STYLEX_TRACER_EVIDENCE="$PWD/benchmarks/stylex-tracer/workflows/relocation-evidence.json" bun benchmarks/stylex-tracer/workflows/compare-roots.ts /absolute/root-a /absolute/root-b`                                                                                    | **PASS** for two physical roots and all archive/artifact/index comparisons.                                                                                       |
| `RYOT_STYLEX_TRACER=1 bun turbo build --env-mode=loose --force --filter=@ryot-app/kernel-client --filter=@ryot-app/stylex-tracer-plugin`                                                                                                                                 | **PASS**; exact production build command recorded in browser evidence.                                                                                            |
| `RUN_STYLEX_TRACER_E2E=1 bun turbo --env-mode=loose --force --output-logs=full --filter=@ryot-app/e2e test --only -- 'src/browser/stylex-tracer.test.ts'`                                                                                                                | **PASS** in Chromium and WebKit against attested production assets.                                                                                               |
| `bun benchmarks/stylex-tracer/run.ts`                                                                                                                                                                                                                                    | **PASS** with caveats; regenerated `result.json` and `result.md`, zero cache hits, no optimization.                                                               |

The first attempted scoped-check invocation used a malformed Bun `--cwd`/shell-operator arrangement.
It failed at command parsing before a checker or test ran. **Status: NOT A CODE CHECK.** It is not
counted as a product or source failure, and the corrected commands above are the reproducible command
record. The malformed transcript was not retained in generated evidence, so this report does not
invent an exact token sequence for it.

This final documentation pass ran
`./node_modules/.bin/oxfmt docs/ryot-stylex-followup-tracer-report.md plugins/stylex-tracer/README.md --write`:
**PASS**, two files formatted. It then ran `git diff --check`: **PASS**, no output. No code, generated
evidence, `AGENTS.md`, manifest, or lockfile was edited during finalization.

## Not run and out of scope

| Item                                                                                             | Status           | Reason                                                                                            |
| ------------------------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------- |
| Backend `ClientPages` prepare A/reuse/edit/restart/prepare B/reuse with persistent rows retained | **NOT RUN**      | Direct compiler lifecycle evidence does not exercise backend preparation or repository selection. |
| Real PostgreSQL cache/transaction/constraint behavior                                            | **NOT RUN**      | Existing harness uses recording database methods; no new PostgreSQL layer was authorized.         |
| Full repository test/check                                                                       | **NOT RUN**      | Scoped follow-up; no claim of repository-wide green status.                                       |
| Filesystem-cold benchmark                                                                        | **NOT RUN**      | Filesystem caches were not flushed.                                                               |
| Linux production proportional-memory enforcement                                                 | **NOT RUN**      | Evidence host is macOS.                                                                           |
| Native Safari application                                                                        | **NOT RUN**      | Playwright WebKit is not Safari application certification.                                        |
| Full media/fitness migration                                                                     | **OUT OF SCOPE** | Follow-up is a bounded tracer, not a product migration.                                           |
| Native iOS/Android certification                                                                 | **OUT OF SCOPE** | Explicitly excluded by the plan.                                                                  |
| Firefox                                                                                          | **OUT OF SCOPE** | Explicitly excluded by the plan.                                                                  |
| Cloudflare/tunnel troubleshooting                                                                | **OUT OF SCOPE** | No live tunnel run required.                                                                      |
| Full CSS feature matrix                                                                          | **OUT OF SCOPE** | The authoring matrix covers required representative cases only.                                   |
| Tailwind cutover or removal                                                                      | **OUT OF SCOPE** | Recommendation is not migration permission.                                                       |
| Broad compiler optimization, persistent transform cache, scheduler replacement, compiler fork    | **OUT OF SCOPE** | No safe localized optimization was established or needed for evidence completion.                 |

## Excluded paths and preserved boundaries

**Status: PASS.** `git diff` and status against the follow-up baseline showed no changes in
`AGENTS.md`, `bun.lock`, root `package.json`, `packages/client-plugin-contract`, `packages/contract`,
or `packages/plugin-kit`. No manifest or lockfile was changed. The requested report finalization edits
only this report and the tracer README.

`apps/website`, `apps/browser-extension`, and `crates/frontend` remain unchanged. Ordinary Tailwind
mode, exact-slug/flag isolation, archived import boundaries, source/asset/artifact limits, extracted
production CSS, immutable artifacts, iframe sandbox, CSP, MessagePort lifecycle, and no-fallback
failure semantics remain part of the retained tracer boundary.

The known router wrapper `background: var(--bg)` dependency remains unresolved and transparent. The
tracer child paints its document background; no hidden alias or fallback was added. This remains a
migration finding rather than a follow-up fix.

## Unresolved regressions and diagnostic gaps

- **FAIL:** trusted source edits are not automatically invalidated in the same compiler generation. A restart is required and now enforced.
- **NOT RUN:** persistent backend prepare/reuse across the restart means stale row selection, process ownership, and restart orchestration are not yet end-to-end proven.
- **OPEN:** compiler process ownership must be made operationally precise for each deployment mode. Restarting a CLI is simple; restarting a long-running backend/compiler generation has service impact.
- **OPEN:** `validateStylexAuthoringConvention` depends on Babel AST shapes and a restrictive call form. This needs an accepted owner and upgrade test policy.
- **OPEN:** plain StyleX 0.19.0 source does not provide the intended property/value guarantee. The solution is permanent custom enforcement plus annotations, not an upstream zero-cost guarantee.
- **OPEN:** arbitrary string values, browser semantics, layout correctness, and complete CSS support are outside the validator's proof.
- **OPEN:** the dominant TypeScript semantic-check difference is observed but not causally attributed. Parent wait time and sampled RSS cannot assign cost to one library.
- **OPEN:** macOS process-tree RSS can miss peaks and double-count shared pages; Linux proportional-memory behavior was not run.
- **OPEN:** one small panel and plugin do not establish product-scale authoring, compile time, or memory headroom.
- **OPEN:** production WebKit passed, but native Safari and devices were not run.
- **OPEN:** the routing wrapper's unsupplied `--bg` remains a migration compatibility issue.
- **PASS:** no evidence indicates stale CSS after HMR removal/recovery, cross-build rule leakage, root-dependent artifacts, or production browser failure in the tested scope.

## Final recommendation

**INVESTIGATE FURTHER.** Preserve the coherent opt-in experiment and do not start cutover.

The technical feasibility result is stronger than the first tracer: practical checked authoring is
enforced in real and archived source, shared kernel edits use state-preserving HMR, production output
works in two Playwright engines, and physically distinct roots are reproducible. The dependency guard
also converts a dangerous stale-identity condition into an explicit error and deterministic restart
workflow.

Adoption is still premature for three concrete reasons. First, the full backend prepare and persistent
reuse lifecycle across the required restart has not been executed. Second, the project would own a
nontrivial AST authoring validator and broad dependency fingerprint/materialization adapter whose
upgrade and diagnostic maintenance need explicit acceptance. Third, the measured StyleX path has
higher compile latency and observed process-tree RSS in this fixture, while the main TypeScript and
memory attribution gaps prevent a confident resource budget decision.

The smallest next gate is one end-to-end backend A/reuse/B-edit/restart/B/reuse/A-restore run that
retains persistent cache state and records build rows, artifact rows, graph identities, worker/backend
generations, and computed B output. If that passes, owners must explicitly accept or reject the
validator/instrumentation maintenance model and the measured latency/RSS envelope. Until both occur,
retain the tracer only as an opt-in investigation. No commit was made, and work stops here before
Tailwind cutover.
