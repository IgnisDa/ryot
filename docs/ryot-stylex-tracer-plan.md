# Ryot StyleX tracer — implementation brief

## 1. Objective and fixed decisions

Implement a bounded, end-to-end StyleX experiment on `IgnisDa/ryot`, based on `ultra-rewrite`. This is an evaluation, not approval to migrate the application.

Prove that shared StyleX components and tokens work through the kernel's Vite build and Ryot's archived-plugin compiler, with useful author-facing diagnostics, correct artifact behavior, and no hidden Tailwind dependency in the plugin proof case.

The reference commit for this brief is `ee4ea35c776c8118e90371293a83d0edc77eb7ec`. Inspect the current checkout before changing it and record the actual implementation base. Read the root and applicable child `AGENTS.md` and README files. Adapt to intervening changes without expanding the agreed scope.

The agreed demonstration is a purpose-built fixture panel, not an existing media screen. Chromium and Playwright WebKit are the initial browser gate. Actual iOS/Android device checks are optional additional evidence; browser emulation must not be reported as native-device verification.

Do not modify `apps/website`, `apps/browser-extension`, or `crates/frontend`. Do not migrate media or fitness UI, existing shared controls, the application shell, or the full palette. No production-data migration is required.

## 2. Deliverables and ownership

Build one small interaction panel rendered in two places: an isolated kernel route and a dedicated experimental plugin. Both must import the same shared trial-component and token source. Thin environment adapters may differ; do not copy the shared implementation into the archive.

Suggested locations are proposals, not existing paths:

| Area | Responsibility |
| --- | --- |
| `packages/client-ui-sdk/src/stylex-tracer/` | Trial button, text field, shared panel, small token/theme set, and presentation-only helpers. |
| An explicit experimental UI SDK subpath and direct token subpath | Imports used by both builds; do not re-export the experiment from the normal root barrel. |
| `plugins/stylex-tracer/` | Minimal fixture plugin, archived client entry, plugin-local token module, and a local image asset. |
| An isolated route under `kernel/client` | Kernel adapter for the panel, using existing theme and viewport services. |
| `packages/client-plugin-compiler` | Narrow experimental compilation integration, diagnostics, and compiler tests. |
| Existing dev/test server composition and E2E infrastructure | Opt-in registration, real artifact loading, and browser verification. |
| A tracer README beside the fixture | Commands, architecture decisions, evidence, limitations, and retain/delete inventory. |

Keep public SDK dependencies environment-neutral. Do not import kernel authentication, router, or Capacitor services into the trial UI implementation. New dependency additions must be scoped to actual consumers and pinned reproducibly.

## 3. Experimental isolation

Normal application behavior and ordinary plugin compilation must remain Tailwind-based and unchanged. The experiment must be opt-in, with no normal sidebar entry or automatic inclusion in shipped plugin archives.

During the first milestone, choose and document one explicit, internal activation mechanism. Prefer dependency injection through a dedicated dev/test composition. A private compiler entry point or a narrowly scoped internal selection seam is acceptable. Do not invent a public styling-engine option, plugin manifest field, alternate wire protocol, or general compiler-strategy framework. Do not infer the engine from arbitrary source strings or silently fall back after StyleX fails.

The experimental plugin must still use canonical archive creation, archive validation, artifact storage/session handling, sandboxed iframe loading, and the existing bootstrap/MessagePort handshake. Do not replace this with hand-authored HTML, a special unsandboxed iframe, or a fake bridge. Document how to launch the opt-in environment and navigate to both surfaces.

Isolate tracer caches and build state from ordinary builds. Cover persistent artifacts, in-memory results, and in-flight deduplication—not only the final content hash. Identical source must never accidentally reuse a Tailwind artifact in a StyleX run or vice versa.

A trusted dependency or token change must invalidate the tracer's reuse decision. Showing that forced compilation generates different bytes is insufficient. Use a narrow tracer build identity/fingerprint or equivalent invalidation scheme; do not redesign the production cache system.

Preserve compiler-owned metadata and current handshake validation. Do not hardcode an old compiler version merely to make the experiment load. If an existing version constant must change, update every affected producer, validator, cache consumer, test, and document together. Do not weaken validation, add legacy decoders, or change the MessagePort protocol solely for styling.

Temporary experiment wiring is allowed; style-translation adapters and permanent dual-engine compatibility architecture are not. Inventory every temporary seam for deletion after the evaluation.

## 4. Shared panel and authoring contract

Use Ryot's existing visual vocabulary, with a small representative token subset rather than a redesign. The panel should be recognizable and interactive, but need no domain queries, backend operations, uploads, or persisted state.

Use the following fixed content and interactions:

| Element | Behavior and styling coverage |
| --- | --- |
| Heading | “StyleX tracer,” with a visible resolved-theme and compact/wide readout. |
| Text field | Label “Name,” initially “Ryot.” Empty input exposes an error message and `aria-invalid`; include placeholder styling. |
| Primary button | “Advance progress.” Progress starts at 35%, advances by 7 percentage points, and clamps at 100%. Disable this action when the field is invalid or progress reaches 100%. |
| Secondary button | “Reset,” restoring the initial input and progress values. |
| Progress indicator | Accessible current value and genuinely runtime-dependent visual width. |
| Portalled information surface | A “Details” trigger opens a small surface outside the panel subtree, showing the current name and progress. Support keyboard dismissal and focus restoration. |
| Presentation | Compact/wide layout, numeric safe-area handling, and one subtle animation with reduced-motion behavior. |

Create exactly two reusable trial controls: a button and a text field. Keep progress and information-surface presentation local to the panel unless a genuinely shared helper is needed. Reuse appropriate nonvisual accessibility primitives; do not build a new overlay framework or restyle an existing modal.

Trial controls use semantic props first. Give the button a deliberately narrow StyleX override prop, such as foreground/background colors while prohibiting positioning. Demonstrate a permitted override at a consumer call site. Do not expose unrestricted `className` or inline `style` props that undermine the experiment's control contract. Preserve required focus and disabled behavior, and prevent forwarded props from accidentally replacing generated styling.

Use ordinary `stylex.create` and `stylex.props` as the single authoring idiom. Do not introduce a utility DSL, `sx` shorthand, a Tailwind translator, or custom style-merging library. Make composition order explicit, favor longhands where overrides interact, and use the same resolution semantics in both builds.

Define a small, complete token set for the panel using named exports in `.stylex.ts` modules. Include surfaces, foregrounds, accent/error/focus colors, fonts, spacing, and radii as needed. Give the plugin a separate archive-local token module used by an actual element, exercising relative token resolution as well as a trusted SDK token import.

The tokens must have their own values and light/dark themes. Do not point them at old `--color-*` or palette variables. Copying the selected initial literal values is acceptable for this isolated experiment; creating a permanent synchronization mechanism is not.

## 5. Build integration and Tailwind independence

First try the current official StyleX Vite and Bun-compatible integrations with the repository's pinned toolchain. Verify them against Ryot's virtual archive loader, not only a standalone filesystem example. Record exact versions, relevant options, plugin ordering, and evidence for the chosen integration.

If the upstream bundler adapter cannot compose with the archive loader, a narrow adapter around the official StyleX transform and rule-processing API is acceptable. Explain the concrete incompatibility and keep the adapter bounded. No compiler fork, patched dependency, alternative bundler migration, or reimplementation of StyleX's extraction/priority logic.

Transform both archived client modules and reachable trusted SDK modules containing StyleX. Preserve original-source TypeScript checking. Configure module/token identity consistently within each build, including named token imports, direct SDK subpaths, and tree-shaken theme dependencies. Do not depend on arbitrary checkout or temporary-directory names. Keep generated CSS collection build-local.

Emit normal production `plugin.js`, `plugin.css`, document, and asset outputs through the existing artifact model. Production must use extracted CSS, with no StyleX runtime stylesheet insertion. Runtime CSS-variable values for dynamic styles are allowed. Development HMR may use the official development mechanism; functional tests must not substitute StyleX's nonfunctional snapshot/test transform.

The experimental plugin must not run Tailwind compilation or load Tailwind output, Preflight, the old UI SDK theme stylesheet, or the old palette stylesheet. Give it a small explicit reset, document scaffold, and existing font handling. Apply concrete StyleX-controlled foreground, background, and typography so inherited kernel styling cannot mask omissions.

Reuse the ordinary plugin bootstrap and routing runtime, but do not mount existing Tailwind-styled visual controls or `PluginScreenFrame` in the proof surface. Audit inherited legacy-variable dependencies in reused runtime code. Do not hide required dependencies with compatibility aliases or replacement utility rules; record a genuine unresolved dependency as a limitation/blocker.

The kernel shell may retain Tailwind, but the panel must not use its utilities. Scope any experimental reset, theme class, and portal styling so they do not restyle existing kernel screens. Define intentional layer ordering; do not depend on whichever stylesheet loads last.

Include the existing fonts and one archive-local image imported from TSX. Preserve asset hashing, MIME restrictions, relative artifact URLs, and CSP. Full CSS `url()` feature coverage is not part of this tracer; any such URLs actually introduced must still resolve correctly and respect source boundaries.

## 6. Themes, viewport, and lifecycle

Use existing theme state as the authority. Support explicit light and dark preferences and system resolution, including a theme change while the plugin and its open information surface remain mounted. Do not add a parallel theme preference store or new bridge fields.

Apply the StyleX theme to both the panel and its portal destination. A portal that inherits accidentally from a nearby wrapper does not establish this requirement. In the kernel, preserve existing document classes and unrelated theme behavior; clean up any experiment-owned DOM modifications on unmount.

Read compact layout and safe-area values from the existing kernel/SDK adapters. Do not derive plugin compact mode from iframe media queries. Include a test where the iframe is narrow but the kernel still reports wide mode. Inject nonzero safe-area values through the existing platform/bridge test seam rather than faking padding only inside the panel.

Respect existing scroll ownership and title semantics. Navigating away and back must not leak listeners, portal nodes, theme state, or document styles. Keep full gesture and native-platform regression work outside this tracer, while checking basic mount/unmount/navigation behavior.

## 7. Diagnostics and security

Extend the experimental import allowlist and TypeScript resolution entries only for exact required StyleX/runtime and SDK subpaths. Keep the ordinary allowlist policy unchanged outside the experiment. Do not permit arbitrary npm imports or StyleX in environment-neutral archived `shared/**` sources.

Validate original-source imports before transformation can remove or rewrite them. The StyleX resolver must enforce the same archive/trusted-module boundaries as bundling. Do not introduce a second unrestricted filesystem resolver for tokens. Disable plugin-controlled Babel configuration discovery and executable build plugins. Do not execute arbitrary archived code to discover styling values. Preserve worker limits and source/artifact limits.

Exercise negative cases through Ryot's actual experimental compilation boundary, asserting meaningful logical file/line/column diagnostics, not standalone tests of TypeScript assignments:

| Invalid input | Required observation |
| --- | --- |
| Missing shared or local token | Actionable author-source diagnostic. |
| Known CSS property forbidden by the trial control contract, such as `position` | Rejected as a contract violation. |
| Unsupported StyleX expression | Transform/validation failure mapped to original source. |
| Misspelled CSS property or clearly invalid constrained value | Record what TypeScript catches; reject through scoped StyleX validation when necessary. |
| Unapproved package or escaping token import | Rejected before any unsafe host resolution. |
| Attempted archived build configuration or executable compiler customization | Ignored/rejected according to the explicit policy, never executed. |

Record which layer detects each case: TypeScript, StyleX validation, transform, or Ryot import policy. Do not claim universal CSS type safety. Include a valid near-neighbor for negative fixtures where needed to show that the intended failure—not unrelated setup—is responsible.

Use upstream StyleX validation for gaps rather than inventing a validator. Prove the chosen integration runs in scoped repository checks and the experimental archive compiler. Keep Oxfmt/Oxlint as the normal toolchain. A small additional scoped runner is acceptable when necessary; do not migrate repository linting or enable conflicting key-sorting rules.

Keep deliberately invalid sources as test fixtures, not normally compiled failing application modules. Compilation failures must leave no partial cache entry and must not fall back to Tailwind.

## 8. Verification and measurements

The implementation is accepted only with reproducible evidence for these checks:

| Check | Required evidence |
| --- | --- |
| Kernel development | Panel works; edits to a shared control and token update correctly, without stale CSS. |
| Kernel production | Production-built kernel route renders and interacts correctly. |
| Archived plugin | Canonical fixture archive compiles, installs/prepares, and renders through the real iframe handshake. |
| Tailwind independence | Plugin build inputs and loaded CSS exclude Tailwind and old theme/palette output; browser-computed styles are correct. |
| Shared-source extraction | A declaration present only in shared SDK source appears and affects the plugin; no copied implementation. |
| Custom client page | Minimal `application: "page"` fixture uses the same trial control/token path, compiles, emits CSS, and executes the generated bootstrap without duplicate entry handling. No third demo screen is required. |
| Appearance and interaction | Chromium and WebKit cover both surfaces, light/dark, compact/wide, field states, permitted override, progress, focus, and portal theming. |
| Dynamic CSS | Progress changes visually without accumulating StyleX-generated stylesheet rules or style elements in production. |
| Lifecycle | Theme changes preserve panel state and iframe identity; leaving/reentering cleans up experiment-owned resources. |
| Reproducibility | Identical production inputs yield identical artifact bytes/hash across repeated clean builds and different working directories. |
| Isolation and invalidation | Distinct concurrent fixtures do not exchange CSS; failed builds do not contaminate later ones; engine/dependency changes cannot reuse stale tracer results. |
| Existing behavior | Existing fixture/compiler tests and relevant kernel/SDK checks remain green; excluded paths stay untouched. |

Use behavioral and computed-style assertions as the primary browser evidence, with a small set of screenshots for visual review. Do not make generated class names or a full minified-JavaScript snapshot the correctness oracle. Wait for font loading before visual capture.

Add a small equivalent Tailwind baseline under test/benchmark infrastructure—not another product screen—with matching controls, interactions, fonts, assets, and production settings. Report total JavaScript plus CSS, their separate sizes, and full artifact size with fonts/assets identified separately. Report compressed sizes when straightforward.

Measure full compilation wall time using one cold-process run and at least five warm-process forced compilations per variant. Distinguish artifact-cache hits from actual compilation; hold hardware and toolchain constant. Record peak memory where reliable and describe the measurement boundary. Compare dependency additions and Ryot-specific integration code qualitatively as well as by rough size.

Do not set invented performance thresholds or claim a speed/size win in advance. If trustworthy measurements are unavailable, report that explicitly rather than estimating. Treat the small fixture's results as local evidence, not predictions for the entire application.

## 9. Work sequence and agent coordination

**Milestone A — boundaries and smallest working slice.** Inspect the current build, archive, session, cache, and test infrastructure. Establish the opt-in activation and cache identity. Agree on shared imports, control props, theme/viewport adapter inputs, and exact upstream versions. Prove one shared styled control plus a shared token and archive-local token through the actual plugin build and kernel build before expanding the UI.

**Milestone B — complete the bounded demonstration.** Implement the panel and both thin adapters. Complete extraction, independent document styles, portal theming, assets, scoped validation, and negative compiler fixtures. Keep all existing product controls and consumers unchanged.

**Milestone C — integration, evidence, and decision.** Run the browser matrix, client-page check, cache/determinism/concurrency tests, relevant existing checks, and baseline comparison. Finish the tracer documentation and evidence report. Do not begin the cutover after a successful tracer.

For multiple agents, parallelize after Milestone A's contracts are stable:

| Workstream | Ownership |
| --- | --- |
| Compiler/infrastructure | Experimental compiler, import policy, diagnostics integration, artifact/cache isolation, and compiler-focused tests. |
| UI/integration | Shared trial components/tokens, fixture plugin, kernel route, theme/viewport adapters, and development build wiring. |
| Verification | Browser tests, regression coverage, baseline measurements, and evidence report. |

One integrator owns package/lockfile changes, shared config, and final acceptance. Coordinate file ownership before parallel edits. Do not run concurrent tests that mutate the same SDK source files; use isolated fixture copies/workspaces for dependency-change tests.

## 10. Documentation, completion, and stop conditions

The tracer README must include exact setup/run/check commands, routes and fixture installation steps, chosen upstream integration/options, cache activation/invalidation behavior, compiler security boundaries, validation coverage, screenshots and measurement results, and a limitations section.

Include a retain/delete inventory: identify production-candidate component/token/transform work separately from experimental routes, baseline fixtures, activation seams, and temporary entry points. Update nearby documentation only where behavior or an exact allowlist changes. Do not advertise StyleX as the repository-wide standard or rewrite the general authoring guide as though migration is complete.

The final agent report must state what was implemented, commands actually run and their results, unrun checks with reasons, measured tradeoffs, diagnostic gaps, and a recommendation of adopt, investigate further, or reject. A recommendation is not permission to perform the migration.

Do not declare success based only on type-checking or bundling. If completion would require a compiler fork, unsafe resolution, a fake lifecycle, hidden Tailwind fallback, a broad existing-UI rewrite, or substantial permanent dual-engine machinery, preserve a coherent disabled experiment and document the concrete blocker and attempted approaches. Do not conceal it with compatibility code or start the full cutover.

Reference material: the repository's root and child guidance; StyleX's official Bun installation, unplugin, Babel plugin, StyleXStyles, defining-variables, defining-styles, and ESLint-plugin documentation. Verify options against the exact installed versions rather than assuming examples match the lockfile.
