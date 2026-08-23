# Ryot StyleX follow-up tracer

## Mandate: close the decision gaps, not start the migration

Extend the **existing committed StyleX tracer** on Ryot’s `ultra-rewrite` work. Do not create a second demonstration or repeat the initial feasibility implementation.

Answer three questions with executable evidence:

1. Does the normal authoring syntax give agents the validation guarantees we actually intend to rely on?
2. Are shared-source editing, plugin rebuild/invalidation, and production/reproducible builds reliable?
3. What are the permanent compiler responsibilities and measured resource costs after separating out experiment-only machinery?

This brief authorizes focused tests, instrumentation, documentation, and small fixes necessary to answer those questions. **It does not authorize a Tailwind cutover, a new styling architecture, or a broad optimization project.** An evidence-backed rejection is an acceptable result.

Reuse the shared panel, two trial controls, kernel `/stylex-tracer-kernel` route, canonical `/stylex-tracer` plugin, custom-page fixture, and benchmark from the first tracer. Preserve opt-in activation, ordinary Tailwind behavior, archive/import/resource boundaries, extracted production CSS, and the real artifact/session/iframe/MessagePort lifecycle. No fallback, compatibility aliases, public engine-selection fields, or additional product UI.

Keep `apps/website`, `apps/browser-extension`, and `crates/frontend` unchanged. Full media/fitness migration, native-device certification, Firefox, a new PostgreSQL test layer, a full CSS feature matrix, and tunnel troubleshooting are outside this follow-up. The recorded router `var(--bg)` dependency remains a migration finding; do not conceal it or rewrite routing to eliminate it here.

## 1. Establish the committed baseline

The user has committed the evaluation work. Use that checkout and record its actual HEAD before editing. Do not substitute the old dirty-worktree report base, assume `HEAD~1` is the pre-tracer state, or reset to the earlier brief’s reference SHA. Do not amend the user’s baseline or overwrite unrelated work.

Read root and applicable child `AGENTS.md`/README files, the tracer source/tests, the supplied `ryot-stylex-tracer-report.md`, and benchmark `result.md` or their repository equivalents. Reports are historical evidence, not proof that the committed checkout still behaves identically.

Record commit, source inventory, exact installed versions, lockfile hash, platform, activation settings, and existing commands. Inspect implementation details before classifying them as defects. Reproduce the relevant baseline checks and one uninstrumented benchmark comparison. Recheck previously reported errors before calling them pre-existing.

The supplied results establish the following **reported starting points**, which this follow-up must refine rather than overstate:

| Prior evidence | Remaining question |
| --- | --- |
| Missing tokens and forbidden control overrides fail; the CSS typo/value examples use `satisfies CSSProperties`. | What is caught in the syntax agents normally write, without test-only strengthening? |
| Vite integration exists, but no source-edit HMR cycle was recorded. | Do shared control/token edits and declaration removal update correctly? |
| Dependency fingerprinting is broad and initialized at process/module startup. | What edits are observed in a running process, and what requires recreation or restart? |
| The reproducibility runner changes cwd after loading modules from one checkout. | Do independently resolved checkouts produce identical outputs and reusable identities? |
| Production build tests verify output inclusion/exclusion. | Has browser behavior been exercised against the production-built kernel? |
| Warm median compilation is about 1,525 ms versus 639 ms; whole-worker memory is higher. | Which stages and processes account for the difference? |
| Integration totals count additions in mixed files and exclude removals. | Which code is permanent, experiment-only, generally useful, or removable Tailwind machinery? |

Locate actual files before editing. Likely owners include `packages/client-plugin-compiler/src/{stylex-tracer,compile,bundle,dependencies,import-policy,source-imports}.ts`, `packages/client-ui-sdk/src/stylex-tracer/`, kernel tracer routes/Vite configuration, backend activation/graph/cache services, `plugins/stylex-tracer/`, the existing E2E suite, and `benchmarks/stylex-tracer/`.

## 2. Workstream A — prove the everyday authoring contract

### A1. Characterize current behavior before fixing it

Run representative examples through **both the normal scoped repository checks and the actual experimental archived-source compiler**. Where the same check applies to trusted SDK sources, cover that owner too. A successful Vite transpilation or an editor diagnostic is not a substitute for these checks.

Start with plain `stylex.create`/`stylex.props`, as an author would use them. Do not add `satisfies`, casts, suppressions, special fixture-only types, or stronger validation flags just to make negative tests pass. Separately test the currently annotated pattern and clearly identify any difference.

| Example | What to establish |
| --- | --- |
| `colour` instead of `color` | Whether an ordinary authored property typo is rejected, and by which layer. |
| `position: "absolut"` | Whether an invalid constrained value is rejected. |
| Missing shared or archive-local token member | Token-reference diagnostics through the actual source-resolution path. |
| A trial button override containing `position` | Enforcement of the control’s permitted-property contract; allowed color/background overrides still work. |
| Supported hover/focus or invalid-state condition, plus a media/reduced-motion condition | Valid conditional StyleX authoring is not incorrectly rejected by a flat CSS-object type. |
| Typed dynamic progress function | Runtime values remain practical and supported under the chosen checking convention. |
| Supported CSS variable/`calc(...)` value actually relevant to the panel | Validation does not ban required flexible CSS syntax merely to achieve stronger tests. |
| Unsupported compile-time expression | A positioned transform/validation diagnostic and no successful artifact/cache entry. |

Use small valid near-neighbors where necessary to show that each rejection has the intended cause. Preserve existing original-source import/security checks. Intentional `any` casts and TypeScript suppression are not the CSS-type-safety target; existing import-policy defenses must still withstand suppression as before.

### A2. Select and enforce one practical convention

Based on A1, prescribe one authoring convention and apply it to the **real trial controls, panel, and plugin-local styles**, not just fixtures. Include short copyable examples covering static styles, conditions, dynamic values, tokens, and restricted overrides.

Prefer the existing StyleX APIs with pinned upstream types/validation. Explicit annotations are acceptable where genuinely necessary, but:

- They must support the conditional and dynamic styles used by the tracer.
- The required convention must be enforced by a scoped check, not merely mentioned in prose.
- Omitting a required annotation/validation mechanism must not silently make the advertised guarantee optional. Prove this by removing it from a normally checked source.

Use upstream StyleX validation/rules for gaps where appropriate, verifying behavior against the installed version. Keep Oxfmt/Oxlint as the existing toolchain; narrowly scoped additional wiring is permitted. Do not build a CSS validator, utility DSL, type-cast wrapper, or repository-wide lint migration. A dependency/version change requires a specific reproduced blocker and before/after evidence, not a speculative upgrade sweep.

The guarantees advertised for plugin authors must also be enforced at the archive compilation boundary. Never execute archived build configuration or author code to obtain validation. Do not weaken supported valid styling simply to make the rejection matrix look better. If a useful contract needs substantial bespoke enforcement, report that as a decision blocker rather than expanding scope.

### A3. Deliver author-facing evidence

Test through Ryot-owned commands and compiler boundaries, not standalone TypeScript assignment tests. Keep intentionally invalid sources in fixtures or isolated copies, not broken application modules.

For each case report plain syntax, prescribed syntax, repository-check result, archive-compiler result, detector layer, diagnostic code, and original logical file/line/column. A failed archive build must neither cache a success nor fall back to Tailwind.

Document the boundary honestly: checked property/token/control contracts, compile-time restrictions, and values still intentionally accepted as strings. Do not claim that types prove visual correctness or universally validate CSS.

**A is complete when the real code follows a reproducibly enforced convention, or the report demonstrates exactly why the desired authoring guarantee is not practical.**

## 3. Workstream B — close editing, invalidation, and build evidence

### B1. Kernel shared-source editing

Use an isolated worktree and real opt-in Vite development server. Automate the source-edit cycle in Chromium where practical; a reproducible scripted/manual browser sequence with retained evidence is acceptable. Do not use mocks of generated CSS or in-browser style mutations.

Open the kernel tracer, change its input/progress, and then perform these source edits sequentially:

| Edit | Expected evidence |
| --- | --- |
| Change one declaration in the shared control source. | The visible/computed result updates without manually restarting the dev server or navigating away. |
| Change an imported shared token value. | Panel and open portalled content update where they consume that token. |
| Remove a declaration whose fallback is observable. | The old declaration stops affecting the element; stale CSS does not win. |
| Introduce an invalid example from the prescribed authoring convention, then restore it. | The designated checker reports the source error, recovery works, and the browser does not remain stuck on stale styles. |
| Restore the original sources. | Original computed styles return and no test mutation remains. |

Record actual update mechanism: state-preserving HMR, automatic full-page reload, or manual restart. Do not call all three “HMR.” Record whether input/progress/dialog state survives and any upstream limitation. Compiler/type feedback may use the documented check/watch command; do not imply that Vite itself runs checks it does not run.

Style/token edits should update automatically and correctly. A required manual restart for ordinary kernel styling edits is an unresolved workflow limitation, not a pass. An automatic reload must be reported separately from state-preserving updates and considered in the recommendation.

Use the existing real shared module/token imports; do not substitute inline styles or invalidate the entire app manually to manufacture a result.

### B2. Archived-plugin dependency invalidation

Inspect where fingerprints and transformed/trusted modules are initialized or cached: CLI, backend service, worker, in-flight table, and persistent repository. Trace the actual lifetimes and distinguish **runtime theme selection** from **editing the source of a theme token**.

Exercise the following using the unchanged canonical plugin source archive and normal prepare/install/build entry points as applicable:

1. Compile/prep version A, render it, and repeat the request to demonstrate correct reuse.
2. Edit a trusted SDK token or control source to version B while leaving the archived plugin bytes unchanged.
3. Request preparation again in the running development setup and record what actually happens. Do not clear caches, force recompilation, or substitute a manually changed fingerprint to claim automatic invalidation.
4. If the supported workflow requires a restart/rebuild, execute the documented command and repeat preparation. Identify exactly which backend, compiler worker, CLI invocation, or watcher generation is recreated.
5. Verify a new dependency/graph identity and artifact containing **B’s actual CSS/behavior**, then verify correct reuse of B. Retain persistent cache state across the required restart.
6. Restore A and verify the supported workflow returns the correct content without stale reuse or resource leaks.

A new identity attached to output from stale in-memory modules is a failure. Existing successful identity-derivation unit tests alone do not establish this behavior. Record source/archive hashes, relevant identity values, compilation/reuse observations, process generations, and computed output.

**Either reliable same-process invalidation or a simple explicit, verified restart/rebuild workflow is acceptable for this tracer.** Do not add a general plugin HMR service, new watcher framework, or rehash/recompile every request simply to obtain automatic behavior. A restart-based result must not be labeled same-process invalidation.

Ensure old in-flight work cannot satisfy a request for a different dependency identity. Reuse existing isolation tests and add one focused regression only where the inspected lifetime/invalidation path needs it. The identity used for persistence must describe the inputs actually compiled.

Preserve immutable artifacts: create/select a new artifact and normal session when dependencies change; do not patch an existing artifact’s CSS in place. Ordinary theme-state switching should continue to preserve panel/iframe state as before.

### B3. Truly relocated builds

Build the same frozen implementation revision from **two physically distinct worktrees/checkouts** in fresh processes. Each must resolve compiler, SDK, and plugin workspace source from its own root, with the same locked dependencies and equivalent logical graph inputs.

A shared package-download cache is acceptable; workspace symlinks/imports back to the first checkout are not. Log resolved real paths to prove the separation. Use isolated build/cache state so success cannot be a cache hit on the first checkout’s output.

Compare canonical archive bytes and all artifact files by name, content type, and bytes, including `index.html`. Also compare dependency/build identities where logical inputs are identical. Compare each variant with itself across roots, not StyleX bytes with Tailwind bytes. Retain a Tailwind relocation control to distinguish StyleX issues from general infrastructure behavior.

Do not normalize or strip differences after compilation to report equality. Trace an actual difference to its inputs/resolution, make only a bounded fix, and rerun. Keep the original cwd-only test as supplementary evidence with its accurate name. Record artifact hashes, input inventories, and equality results.

### B4. Browser checks against production kernel output

Serve the actual opt-in **production-built** kernel with the real test backend, not the Vite development server. Exercise both tracer surfaces in Chromium and Playwright WebKit using existing tests where possible. Confirm which server/build supplied the assets.

Cover initial render, a field/progress interaction, permitted override/focus, theme change with the portal open, and plugin lifecycle re-entry. Reuse the initial tracer’s broader matrix rather than duplicating its suite. Retain the flag-off production exclusion check and normal client-plugin regression.

Keep development-edit evidence and production-browser evidence separate. Do not report Playwright WebKit as an actual iOS/device or Safari-application test. No Cloudflare run is required.

## 4. Workstream C — explain resource cost and permanent machinery

### C1. Measure before optimizing

Extend the existing benchmark, retaining equivalent StyleX and Tailwind fixtures, identical semantic work, fonts/assets, production options, limits, and zero cache hits for forced-compilation measurements.

Add opt-in timing evidence around the actual pipeline, including work outside the previously timed compile body:

| Stage | Attribution to capture |
| --- | --- |
| Fresh-process startup/imports and dependency fingerprinting | One-time initialization versus per-compilation cost; do not omit module-initialization work. |
| Graph/input validation and original-source preflight | Bytes/modules examined, including relevant unreachable-source validation. |
| Dependency/source reads and temporary materialization | Time and relevant file/byte counts. |
| TypeScript semantic checking | Actual checking time for each equivalent variant. |
| StyleX module transformation and Bun bundling | Archive/trusted-module counts, transformation time, and its relationship to enclosing bundling time. |
| CSS emission | StyleX rule processing or Tailwind scanning/building, with relevant counts. |
| Fonts/assets, hashing, artifact construction, and cleanup | Remaining attributable work and uninstrumented residual. |

Use monotonic timings. Label inclusive/overlapping spans: transforms inside bundling cannot simply be added to total bundling time. Distinguish one-time and amortized costs. Metrics must not enter emitted application assets, identity inputs as runtime values, or default production logs.

For comparable totals, run an uninstrumented benchmark as well. Use at least one fresh-process run per variant and one unreported forced warmup plus at least five measured warm compilations. Alternate StyleX/Tailwind batch order and report all samples, median, range, process boundaries, versions, machine, and source revision. State filesystem-cache limitations; do not call fresh-process measurements filesystem-cold.

Report raw and compressed JS, CSS, combined JS+CSS, and full artifact size with fonts/assets separated. Preserve the first tracer’s numbers as historical results; do not present differences across machines/toolchains as an isolated code improvement.

### C2. Memory and actual concurrency

Retain whole-worker peak RSS measurements, explaining whether TypeScript/compiler work runs in the same process or child processes. Phase samples are useful, but RSS/high-watermark differences do not establish per-library allocation cost. Mark memory attribution as unresolved where it cannot be measured reliably.

Run a bounded two-build concurrency comparison through the actual configured compiler/scheduler boundary, with two distinct uncached inputs. Establish that both builds overlap, finish correctly, and preserve CSS isolation. Compare single-build and paired behavior for both variants using the same instrumentation.

Record pair wall time, observed process/worker peaks and process topology, and any available aggregate observation. Explain double-counting/shared-memory limitations of summed RSS. Do not infer paired peak usage by doubling a single-worker number, or hide children outside the measured process. Identify which execution boundary the existing memory/concurrency limits actually govern.

Do not raise limits, reduce concurrency, remove validation, change the fixtures, or omit fonts/assets to improve results. No arbitrary speed/memory threshold is imposed: report actual failure/headroom and its limits.

### C3. Strict optimization boundary

Profiling and explanation are required; making StyleX faster is not a completion requirement.

At most one localized, behavior-preserving optimization may be implemented after a measured cause is established. Preserve before/after samples and the original baseline, and rerun affected diagnostics, security, determinism, invalidation, and browser checks.

Do not add persistent transform caches, custom scheduling, compiler forks, dependency sweeps, or a bundler replacement. Broader ideas belong in the report with evidence, not in this tracer’s implementation.

### C4. Steady-state code and dependency accounting

Produce a source-backed inventory of what a future **StyleX-only in-scope client** would retain and remove. This is analysis, not permission to perform those removals.

| Classification | Examples to verify against committed source |
| --- | --- |
| Permanent StyleX integration | Bounded resolution/materialization, upstream transform/extraction adapter, required validation/type/runtime wiring. |
| Experiment-only coexistence | Flags, exact-slug activation, dual-engine separation, isolated routes, demonstration/benchmark plumbing. |
| Generally required compiler safeguards | Original import policy, limits, diagnostics, hashing/invalidation, asset handling; distinguish genuinely reusable code from StyleX-specific implementation. |
| Tailwind-specific code removable on adoption | Candidate scanning, Tailwind entry injection, Tailwind token/layer directives and associated resolver plumbing—not generic font or asset handling. |
| Candidate UI versus disposable demonstration | Control/token implementations separately from panel behavior and fixture adapters. |

For each item give file/function or line range, responsibility, current size where useful, proposed disposition, and dependencies. Show additions and removable code separately; do not use net line count as a quality score or double-count mixed responsibilities. Audit declarations/adapters for unsound broad types or unsupported upstream assumptions instead of counting all lines equally.

Use a verified historical pre-tracer comparison when available and identify it; otherwise label attribution as estimated. Separate tests/evidence from runtime/compiler code. List direct/transitive dependency implications and in-scope removals; excluded consumers may still require Tailwind repository-wide.

Conclude with a concrete description of the permanent pipeline and largest maintenance obligations, without implementing a production abstraction or removal plan.

## 5. Agent sequencing and regression boundaries

An integrator first pins baseline revisions and agrees on the canonical authoring API, instrumentation boundaries, worktree ownership, and evidence locations.

| Workstream | Primary ownership |
| --- | --- |
| A: authoring/compiler | Validation/type convention, source diagnostics, minimal compiler changes. |
| B: workflows/builds | Isolated edit/relocation scripts, kernel production serving, browser evidence; coordinate fingerprint/lifetime fixes with A. |
| C: performance/accounting | Benchmark instrumentation/results and source inventory; coordinate compiler timing hooks with A. |

Only one owner edits compiler hot spots, package manifests, and lockfiles at a time. Use disposable separate worktrees and distinct ports/cache roots for source-mutating tests. Restore files in cleanup; never mutate another agent’s measured source tree.

Freeze the implementation after integration, then run relocation, final browser checks, profiling, and uninstrumented totals on that same revision. Record instrumentation/evidence revisions and any remaining generated-file diff. Do not benchmark one agent’s work while another edits its dependencies.

Rerun relevant package checks, compiler/CLI/backend cache and activation tests, custom-page compilation, existing local tracer browser coverage, flag-off production exclusion, and normal client-plugin regression. Match the current repository commands rather than blindly copying older command paths. Add tests at Ryot-owned boundaries, not tautological library or assignment tests.

Do not fix unrelated failures or demand a full-repository green run outside scope. Reproduce and precisely qualify any pre-existing/environmental failure. Preserve import limits, failure cleanup, no fallback, and ordinary-mode isolation throughout.

## 6. Deliverables and final decision

Keep the first report intact. Add a clearly dated **follow-up report** and machine-readable evidence under the existing tracer/benchmark organization. Update the tracer README with the actual authoring/check/edit/rebuild commands. Add only stable, non-obvious scoped rules to `AGENTS.md`; do not advertise StyleX as the repository standard.

Required deliverables:

| Deliverable | Contents |
| --- | --- |
| Authoring contract | Real-source examples, enforced convention, raw-versus-prescribed detector matrix, diagnostic samples, acknowledged limits. |
| Workflow evidence | Shared-control/token/remove/error-recovery edit cycle; HMR/reload classification and state behavior; plugin lifetime/invalidation sequence and exact restart workflow where applicable. |
| Reproducibility and production proof | Two-root resolution logs, inventories/byte comparisons, and Chromium/WebKit assertions against actual production kernel output. |
| Resource profile | Raw timing/size/RSS samples, stage accounting, single/paired execution evidence, measurement caveats, any bounded optimization before/after. |
| Permanent-cost inventory | Verified retained/experiment-only/general/removable responsibilities, dependency implications, and review findings. |
| Final recommendation | Adopt, reject, or investigate further with concrete blockers and the smallest missing evidence—not another generic list of future experiments. |

Use explicit `PASS`, `FAIL`, `NOT RUN`, and `OUT OF SCOPE` statuses. Attach qualifications rather than labeling startup-only invalidation as live invalidation, cwd changes as relocated checkouts, output inspection as production-browser testing, or annotated fixtures as universal authoring guarantees.

The follow-up is evidence-complete when these decision gaps have been answered, even if a result argues against adoption. A positive recommendation requires practical enforced authoring, correct edit/rebuild behavior without stale reuse, production/relocation evidence, and an understandable permanent compiler/resource tradeoff. It does not require an invented performance win or native/product-scale verification outside scope.

Finish with exact tested revisions and commands, changed code and why, unresolved regressions, historical versus new measurements, and a revised retain/delete inventory. Preserve a coherent opt-in experiment if blocked. **Stop after the recommendation; do not start the Tailwind cutover or remove the experiment automatically.**

## Source basis

This brief derives from the supplied `ryot-stylex-tracer-report.md`, `result.md`, and the subsequent agreed evaluation. Their observations are historical reported evidence, not independently re-executed results. The newly committed local checkout is the implementation authority; its SHA must be recorded by the implementing agents.
