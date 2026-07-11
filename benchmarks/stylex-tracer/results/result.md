# StyleX tracer follow-up benchmark result

Status: **PASS** with attribution caveats. No optimization was made.

## Environment

- HEAD: `1fc9e0490c2e871270558fe3783eb52205d1a49b`; requested baseline: `4c312ef838bf7bdc38896644f262869750f88d9d`; historical pre-tracer parent: `5228cc84a29d98283800f90b39434825a407f51a`
- Machine: Mac16,12, arm64, 10 logical CPUs, 17179869184 bytes; macOS 26.3.1
- Bun 1.4.0 (34cbb9a40b4bd1bd767d134a7065e66c2432a676), StyleX 0.19.0, Babel plugin 0.19.0, Tailwind CSS 4.3.0
- Lockfile SHA-256: `ca94b1a8fd8200c844df0ac0960ccebcff5df296e912f7f8392c2bc219eade99`; worktree dirty: true; activation: unset
- Dirty-tree manifest SHA-256: `df35dc2ed709547b3550f3ec01e1efb4abb56d2da21a876405210ecaec4b1ec9`; stable during measurement: true. Exact paths and hashes are in JSON.

## Uninstrumented Totals

| Variant  | JS raw / gzip B | CSS raw / gzip B | JS+CSS raw / gzip B | Fonts B (files) | Local assets B (files) | Full artifact B | Fresh-process wall ms | Warm forced compile samples ms              |       Median [min, max] ms | Fresh peak RSS B |
| -------- | --------------: | ---------------: | ------------------: | --------------: | ---------------------: | --------------: | --------------------: | ------------------------------------------- | -------------------------: | ---------------: |
| StyleX   | 606248 / 188928 |     11402 / 4240 |     617650 / 193168 |      205324 (9) |                230 (1) |          823742 |               1978.35 | 1615.03, 1665.14, 1636.48, 1585.94, 1659.66 | 1636.48 [1585.94, 1665.14] |        652820480 |
| Tailwind | 597595 / 185327 |     44586 / 9853 |     642181 / 195180 |      205324 (9) |                230 (1) |          848273 |                883.53 | 652.65, 674.68, 661.04, 648.43, 684.17      |    661.04 [648.43, 684.17] |        382599168 |

One uninstrumented fresh process was used per variant. One separate warm process discarded one warmup per variant, then measured five alternating rounds. Cache hits were zero. Fresh means process-cold, not filesystem-cold. Exact graph-input file hashes are in JSON. The historical first-tracer result is retained in JSON and is not compared as an isolated improvement because its revision, fixture state, and toolchain differ.

## Exact Instrumentation

| Variant  | Span                          | Monotonic ms | Attribution |
| -------- | ----------------------------- | -----------: | ----------- |
| stylex   | input-validation              |         0.24 | exact       |
| stylex   | original-source-preflight     |        28.98 | exact       |
| stylex   | dependency-reads              |          4.1 | exact       |
| stylex   | trusted-reads-materialization |        14.08 | inclusive   |
| stylex   | stylex-transform              |         6.21 | inclusive   |
| stylex   | stylex-transform              |        12.97 | inclusive   |
| stylex   | stylex-transform              |         1.21 | inclusive   |
| stylex   | stylex-transform              |         2.74 | inclusive   |
| stylex   | stylex-transform              |         1.37 | inclusive   |
| stylex   | stylex-transform              |         6.34 | inclusive   |
| stylex   | stylex-transform              |         8.64 | inclusive   |
| stylex   | cleanup                       |         0.44 | inclusive   |
| stylex   | bundle                        |        75.31 | inclusive   |
| stylex   | typescript-check              |      1556.54 | exact       |
| stylex   | css-emission                  |         1.15 | exact       |
| stylex   | assets                        |         0.02 | exact       |
| stylex   | hashing-artifact              |         0.69 | exact       |
| stylex   | compilation-total             |      1667.24 | inclusive   |
| stylex   | uninstrumented residual       |          0.2 | unresolved  |
| tailwind | input-validation              |         0.23 | exact       |
| tailwind | dependency-reads              |         4.95 | exact       |
| tailwind | bundle                        |        20.69 | inclusive   |
| tailwind | typescript-check              |       641.51 | exact       |
| tailwind | css-emission                  |         21.5 | exact       |
| tailwind | assets                        |         0.01 | exact       |
| tailwind | hashing-artifact              |          0.7 | exact       |
| tailwind | compilation-total             |       689.85 | inclusive   |
| tailwind | uninstrumented residual       |         0.27 | unresolved  |

These values come only from current opt-in hooks. Inclusive spans overlap their nested spans: bundling includes trusted reads/materialization, StyleX transforms, cleanup, and native Bun work; compilation-total includes all compiler spans. The residual subtracts only sequential top-level spans. Instrumented and uninstrumented artifact identities matched. Remaining attribution is listed below and not estimated from CPU samples.

## Configured Concurrency

| Variant  | Single boundary wall ms | Two-build boundary wall ms | Observed overlap ms | CSS isolated | Single / pair sampled aggregate peak RSS B | Pair observed process count |
| -------- | ----------------------: | -------------------------: | ------------------: | ------------ | -----------------------------------------: | --------------------------: |
| stylex   |                 1981.25 |                    2146.49 |             2122.72 | true         |                     963248128 / 1775534080 |                           5 |
| tailwind |                  922.86 |                    1113.49 |             1079.21 | true         |                     728711168 / 1350762496 |                           5 |

This uses the actual kernel `ClientPluginCompiler.layer`: semaphore limit 2, one supervised `bun --smol` child per request, and one `tsc` semantic-check child per compiler worker. Pair inputs are distinct and uncached. Worker hook records and process topology are in JSON. The 5 ms `ps` aggregate can miss peaks and double-count shared pages. macOS cannot exercise Linux `/proc` proportional-memory enforcement.

## Permanent-Cost Inventory

| Classification     | Source                                                                  | Symbol                                                          | Lines / bytes | Responsibility                                                                                                    | Proposed disposition                                                                                                 |
| ------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------- | ------------: | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| permanent-stylex   | `packages/client-plugin-compiler/src/stylex-tracer.ts:667-856`          | `createStylexTracerBundleAdapter`                               |    190 / 6885 | Bounded trusted/archive materialization, custom resolution, Babel StyleX transform, rule collection, and cleanup. | Retain after removing tracer naming and narrow it to the adopted client scope.                                       |
| permanent-stylex   | `packages/client-plugin-compiler/src/stylex-tracer.ts:857-869`          | `compileStylexTracerStyles`                                     |      13 / 594 | Process extracted StyleX rules and combine reset, fonts, and build marker.                                        | Retain extraction; reconsider experiment marker/reset placement for production.                                      |
| permanent-stylex   | `packages/client-plugin-compiler/src/stylex-tracer.ts:202-437`          | `validateStylexAuthoringConvention and AST helpers`             |    236 / 7330 | Enforce checked StyleX declaration shapes before Babel transformation by probing the parsed AST.                  | Retain if the convention is adopted; review the broad object/property probing whenever the parser AST shape changes. |
| permanent-stylex   | `packages/client-plugin-compiler/src/stylex-tracer.ts:60-178`           | `deriveStylexTracerBuildFingerprint and tracerDependencyInputs` |    119 / 3843 | Hash compiler, trusted source, package, runtime, lockfile, and font inputs at module startup.                     | Retain build invalidation but replace tracer naming and review the broad startup read set for an adopted scope.      |
| permanent-stylex   | `packages/client-plugin-compiler/src/dependencies.ts:85-96`             | `resolveStylexTracerTypeScriptEntries`                          |      12 / 384 | Provide TypeScript entries for the StyleX runtime and trusted UI modules.                                         | Retain with the adopted public authoring surface.                                                                    |
| experiment-only    | `packages/client-plugin-compiler/src/stylex-tracer.ts:19-58`            | `tracer modules, reset, options, and adapter identity`          |     40 / 1408 | Exact experiment allowlist, tracer reset, pinned options, and tracer build identity.                              | Remove tracer-specific names and coexistence identity; retain only adopted options/reset requirements.               |
| experiment-only    | `kernel/backend/src/modules/plugins/stylex-tracer-activation.ts:1-31`   | `StylexTracerActivation`                                        |     31 / 1060 | Exact-slug, opt-in backend activation seam.                                                                       | Delete after adoption or rejection.                                                                                  |
| experiment-only    | `kernel/client/src/routes/_authenticated/stylex-tracer-kernel.tsx:1-19` | `Route`                                                         |      19 / 676 | Opt-in kernel demonstration route.                                                                                | Delete after the decision.                                                                                           |
| experiment-only    | `plugins/stylex-tracer/client/page.tsx:1-86`                            | `StylexTracerPage`                                              |     86 / 2680 | Archived proof-page adapter and local token demonstration.                                                        | Delete after the decision; it is not product UI.                                                                     |
| general-safeguard  | `packages/client-plugin-compiler/src/compile.ts:273-512`                | `compileClientPlugin input preparation`                         |    240 / 8661 | Graph/path checks, limits, UTF-8 decoding, and content-addressed asset names.                                     | Retain independent of styling engine.                                                                                |
| general-safeguard  | `packages/client-plugin-compiler/src/source-imports.ts:1-173`           | `validateOriginalClientImports`                                 |    173 / 4985 | Validate original imports before transforms can erase policy evidence.                                            | Retain; StyleX extends its exact policy but does not own the safeguard.                                              |
| general-safeguard  | `packages/client-plugin-compiler/src/semantic-check.ts:35-89`           | `checkClientPluginTypes`                                        |     55 / 1693 | TypeScript semantic checking of original reachable sources.                                                       | Retain independent of styling engine.                                                                                |
| general-safeguard  | `packages/client-plugin-compiler/src/compile.ts:697-821`                | `reachable limits and artifact construction`                    |    125 / 4005 | Reachability limits, asset deduplication, hashing, document construction, and artifact limits.                    | Retain independent of styling engine.                                                                                |
| tailwind-removable | `packages/client-plugin-compiler/src/styles.ts:194-276`                 | `compileClientStyles`                                           |     83 / 2656 | Inject Tailwind, scan candidates, build utilities, and combine legacy theme/palette CSS.                          | Remove only for an in-scope StyleX-only client; preserve generic stylesheet asset rewriting separately.              |
| tailwind-removable | `packages/client-plugin-compiler/src/dependencies.ts:196-214`           | `ordinary compiler dependency branch`                           |      19 / 835 | Read SDK scan sources, Tailwind entry, theme stylesheet, and palette stylesheet.                                  | Remove from the adopted in-scope client path; excluded repository consumers still use Tailwind.                      |
| candidate-ui       | `packages/client-ui-sdk/src/stylex-tracer/controls.tsx:1-198`           | `StyleXTracerButton and StyleXTracerTextField`                  |    198 / 5335 | Semantic accessible controls with constrained StyleX overrides.                                                   | Candidate patterns, not production-ready components without API/design-system review.                                |
| candidate-ui       | `packages/client-ui-sdk/src/stylex-tracer/tokens.stylex.ts:1-56`        | `tracerTokens and tracerTheme`                                  |     56 / 1448 | Typed token and theme authoring proof.                                                                            | Retain the authoring pattern only; replace demonstration values under a real token contract.                         |
| disposable-ui      | `packages/client-ui-sdk/src/stylex-tracer/panel.tsx:1-318`              | `StyleXTracerPanel`                                             |    318 / 9607 | Interactive demonstration panel, portal, shortcut, theme, and viewport proof.                                     | Delete after the decision; product behavior was not established.                                                     |
| disposable-ui      | `benchmarks/stylex-tracer/fixture/tailwind/page.tsx:1-168`              | `TailwindTracerPage`                                            |    168 / 5182 | Benchmark-only semantic comparison adapter.                                                                       | Delete when benchmark evidence is no longer retained.                                                                |

Ranges are source-backed responsibility slices, not a net line-count score. Mixed responsibilities and overlaps must not be summed. Dependency implications and classification totals are in JSON. Tailwind remains required by excluded repository consumers.

## Unresolved Attribution

- Fresh import timing includes benchmark imports and dependency fingerprinting; those parts are not separately hooked.
- Dependency reads are one enclosing span; individual source, font, and package reads are not separately timed.
- The TypeScript span measures the parent waiting for semantic checking. TypeScript executes in a tsc child, so CPU and memory attribution remain unresolved.
- The bundle span is inclusive. Trusted reads/materialization, each StyleX transform, cleanup, and native Bun.build work occur inside it and cannot be added to it.
- Tailwind scanning and build are inside CSS emission but do not have separate timing hooks; StyleX rule processing is also inside CSS emission. Their exact attribution remains unresolved.
- Font reads occur in dependency reads. Asset emission and hashing/artifact construction are timed, but finer attribution within each span remains unresolved.

## Caveats

- Filesystem caches were not flushed; thermal state and background load are uncontrolled.
- Process RSS does not establish per-library allocation cost; /usr/bin/time and sampled process-tree aggregates use different boundaries.
- macOS ps aggregate RSS can double-count shared pages, is sampled, and does not provide the Linux proportional-memory supervision used by production.
- The fixture is small and does not predict product-screen or whole-application cost.
- No optimization was made.
