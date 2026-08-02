# StyleX tracer plugin

This package is a bounded, opt-in compilation fixture. It is not a shipped plugin, a public styling
engine option, or permission to migrate Ryot from Tailwind CSS. See the full evaluation in
[`docs/ryot-stylex-followup-tracer-report.md`](../../docs/ryot-stylex-followup-tracer-report.md). The
first [`tracer report`](../../docs/ryot-stylex-tracer-report.md) is historical evidence only.

## Setup And Commands

Run from the repository root. Bun 1.4.0 or later is required.

```sh
bun install
bun run --cwd plugins/stylex-tracer check
bun run --cwd plugins/stylex-tracer build
bun turbo --filter=@ryot-app/client-plugin-compiler check
bun turbo --filter=@ryot-app/kernel-backend check
```

`build` executes `RYOT_STYLEX_TRACER=1 ryot plugin build` and writes the canonical archive to
`plugins/stylex-tracer/dist/stylex-tracer.zip`. Use this command; do not create the zip manually.

Run the scoped checks with these exact commands:

```sh
bun turbo --filter=@ryot-app/client-plugin-compiler test
bun turbo --filter=@ryot-app/cli test
bun turbo --filter=@ryot-app/kernel-backend test --only -- 'src/modules/client-pages/graph.test.ts' 'src/modules/client-pages/service-cache.test.ts' 'src/modules/client-pages/repository-cache.test.ts' 'src/modules/plugins/installation-service.test.ts' 'src/modules/plugins/stylex-tracer-activation.test.ts'
bun --bun run --cwd kernel/client vitest run 'src/routes/_authenticated/-stylex-tracer-kernel-gate.test.ts'
bun --bun run --cwd kernel/client vitest run 'src/routes/_authenticated/-stylex-tracer-build.test.ts'
bun --bun run --cwd kernel/client vitest run --config src/routes/_authenticated/-stylex-tracer.vitest.config.ts
RYOT_STYLEX_TRACER=1 bun turbo --env-mode=loose --filter=@ryot-app/kernel-client build
RUN_STYLEX_TRACER_E2E=1 bun turbo --env-mode=loose --filter=@ryot-app/e2e test --only -- 'src/browser/stylex-tracer.test.ts'
bun turbo --filter=@ryot-app/e2e test --only -- 'src/browser/client-plugin.test.ts'
bun benchmarks/stylex-tracer/run.ts
```

The benchmark rewrites `benchmarks/stylex-tracer/results/result.json` and `result.md`. Its direct
compiler calls are forced compilations, not artifact-cache hits.

Use these exact follow-up workflow commands from the repository root. The HMR and dependency checks
edit trusted sources temporarily, so point them only at a disposable root with its own installed
dependencies.

```sh
# Authoring and archive boundary
bun run --cwd plugins/stylex-tracer check
bun turbo --filter=@ryot-app/client-plugin-compiler check
bun turbo --filter=@ryot-app/client-plugin-compiler test

# Real Vite edit cycle
RUN_STYLEX_TRACER_E2E=1 \
RUN_STYLEX_TRACER_HMR_E2E=1 \
STYLEX_TRACER_HMR_ROOT=/absolute/disposable-root \
STYLEX_TRACER_HMR_EVIDENCE="$PWD/benchmarks/stylex-tracer/workflows/hmr-evidence.json" \
  bun --bun run --cwd e2e vitest run 'src/browser/stylex-tracer-hmr.test.ts'

# Trusted dependency lifetime and required fresh compiler generation
bun run --cwd plugins/stylex-tracer build
STYLEX_TRACER_EVIDENCE="$PWD/benchmarks/stylex-tracer/workflows/invalidation-evidence.json" \
  bun benchmarks/stylex-tracer/workflows/invalidation-lifecycle.ts /absolute/disposable-root

# Production browser build and Chromium/WebKit check
RYOT_STYLEX_TRACER=1 bun turbo build --env-mode=loose --force \
  --filter=@ryot-app/kernel-client --filter=@ryot-app/stylex-tracer-plugin
RUN_STYLEX_TRACER_E2E=1 bun turbo --env-mode=loose --force --output-logs=full \
  --filter=@ryot-app/e2e test --only -- 'src/browser/stylex-tracer.test.ts'

# Two-root relocation after independent frozen installs
STYLEX_TRACER_EVIDENCE="$PWD/benchmarks/stylex-tracer/workflows/relocation-evidence.json" \
  bun benchmarks/stylex-tracer/workflows/compare-roots.ts /absolute/root-a /absolute/root-b

# Uninstrumented/instrumented/concurrency benchmark report
bun benchmarks/stylex-tracer/run.ts
```

If a trusted StyleX SDK source changes in a running server generation, compilation intentionally fails
with `RYOT_CLIENT_STYLEX_RESTART_REQUIRED`. Stop that server and restart it with
`RYOT_STYLEX_TRACER=1 bun run --cwd apps/server src/main.ts`, then repeat normal page preparation. A
fresh plugin `build` command is already a fresh compiler process. This is an explicit restart workflow,
not same-process dependency invalidation; backend persistent prepare-cache reuse across the restart is
not yet executed.

The final client-plugin compiler check passes after fixing the tracer-owned Babel declarations. The
backend full check is blocked only by two pre-existing `TS2552` `RequestInfo` errors in
`kernel/backend/src/lib/infrastructure/pro-key.test.ts` at lines 21 and 29. The backend failure is not
from the tracer compiler declarations.

## Canonical Installation And Routes

The E2E suite uses the production installation path:

1. Global setup builds the kernel and fixture with `RYOT_STYLEX_TRACER=1` and assembles the normal
   server.
2. `installStylexTracerPlugin` reads
   `plugins/stylex-tracer/dist/stylex-tracer.zip` through `readPluginArchive`.
3. It uploads that decoded canonical package unchanged through `installPrivatePluginPackage` and
   waits for `settledPrivateInstallation`. It does not rewrite or add a route to the manifest.
4. The suite signs in and opens both routes below.

The uploaded archive SHA-256 in the final E2E run was
`0736e2d3b3c0b58c5619122d7c957ff512ccd37054d480d833bf9d0484b18c0c`.

| Route                   | Surface                                               | Availability                                                             |
| ----------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `/stylex-tracer-kernel` | Kernel-owned comparison panel                         | Authenticated kernel built with `RYOT_STYLEX_TRACER=1`; no sidebar entry |
| `/stylex-tracer`        | Canonical plugin route in the normal sandboxed iframe | After canonical private-plugin installation                              |

The manifest declares plugin route `/`, exported as `stylex-tracer-page`; the normal slug router maps
it to `/stylex-tracer`. The separate kernel suffix prevents route collision.

## Opt-In Behavior

| Setting                   | Effect                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Unset or not `1`          | No StyleX Vite plugin; `/stylex-tracer-kernel` returns not found; ordinary Tailwind compilation remains active; tracer E2E is skipped           |
| `RYOT_STYLEX_TRACER=1`    | Adds the StyleX Vite plugin and kernel route at build time; enables backend/CLI tracer compilation only for exact manifest slug `stylex-tracer` |
| `RUN_STYLEX_TRACER_E2E=1` | Enables the dedicated browser suite and passes `RYOT_STYLEX_TRACER=1` to E2E builds and API startup                                             |

The fixture build script sets the internal flag. The CLI rejects the flag for any other manifest
slug. The backend checks the exact slug during installation and page preparation. The fixture is not
in shipped plugin registration or ordinary E2E build filters. Turbo's `build` task declares
`RYOT_STYLEX_TRACER` as an environment input, so enabled and disabled build-cache keys cannot alias.
The direct Vite production-artifact test proves a disabled build emits no `stylex-tracer-screen` chunk
or `ryot-stylex-tracer` CSS, while the opt-in build emits both.

## Architecture

### Shared Surface

- `host/plugin.ts` declares one client page and no backend behavior.
- `client/page.tsx` is a thin adapter over the normal plugin router, theme/viewport bridge, safe-area
  values, floating root, and document scaffold.
- `kernel/client/src/routes/_authenticated/-stylex-tracer-screen.tsx` is the thin kernel adapter. It
  reads shell theme, compact state, and safe areas and creates an external body portal root.
- `packages/client-ui-sdk/src/stylex-tracer/` owns the shared panel, controls, themes, and tokens.
  Neither environment copies the shared implementation.

### Official Versions, Options, And Order

| Context                          | Integration                                       | Configuration                                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kernel                           | `@stylexjs/unplugin/vite@0.19.0`                  | Included only when `RYOT_STYLEX_TRACER=1`; `devMode: "full"`, `runtimeInjection: false`, CommonJS module resolution rooted at the repository, `.stylex` theme extension, `ryot-stylex-tracer` layer prefix before `theme`, `base`, `components`, `utilities` |
| Kernel plugin order when enabled | Vite plugin array                                 | StyleX, TanStack devtools, Tailwind, TanStack Router, React                                                                                                                                                                                                  |
| Archive                          | `@stylexjs/babel-plugin@0.19.0` with Babel 7.29.0 | TypeScript syntax, JSX syntax, then StyleX transform                                                                                                                                                                                                         |
| Archive StyleX options           | Production transform                              | `dev: false`, `test: false`, `runtimeInjection: false`, `treeshakeCompensation: true`, `importSources: ["@stylexjs/stylex"]`, `propertyValidationMode: "throw"`, `styleResolution: "property-specificity"`                                                   |
| Archive CSS                      | Official `processStylexRules`                     | `useLayers: { prefix: "ryot-stylex", before: ["ryot-tracer-reset"] }`                                                                                                                                                                                        |

No manual edit/HMR cycle was recorded. The Vite configuration has development support, but the
accepted evidence is scoped tests and production builds/browser runs, not a claim that HMR was
manually proven.

### Why The Official Bun Adapter Was Not Used

The installed official Bun adapter registers `onLoad` for JavaScript/TypeScript and reads
`Bun.file(args.path)`. Ryot owns authorized source bytes in virtual contributor namespaces and export
maps; it does not expose an unrestricted filesystem module graph. The adapter also writes collected
CSS to `dist/stylex.dev.css` under `process.cwd()` and suppresses write failures instead of returning
CSS through Ryot's immutable artifact model.

The bounded adapter uses official Babel transformation and official `processStylexRules`. It
materializes only already-authorized archived TypeScript under a temporary root, resolves only the
bounded archive/trusted maps, collects rules per build, emits normal artifact files, and removes the
temporary root on success or failure. It is not a compiler fork or a reimplementation of StyleX rule
priority.

### Module, Token, And Dependency Identity

Tracer mode adds exactly these client bare imports:

```text
@stylexjs/stylex
@ryot-app/client-ui-sdk/overlay
@ryot-app/client-ui-sdk/shortcut
@ryot-app/client-ui-sdk/stylex-tracer
@ryot-app/client-ui-sdk/stylex-tracer/tokens.stylex
```

Both surfaces import the same panel and token module. The plugin also imports
`./tokens.stylex` to prove archive-local `defineVars` resolution. Canonical paths use
`/__ryot_stylex__/<archive-logical-path>` and
`/__ryot_stylex__/trusted/stylex-tracer/<trusted-relative-path>`, so class/token identity does not
depend on checkout or temporary-directory names.

`STYLEX_TRACER_BUILD_FINGERPRINT` includes:

- Exact adapter options/version and reset bytes.
- The client-plugin compiler implementation source files and the exact `Bun.version`/`Bun.revision`
  pair.
- `bun.lock`, client SDK/UI SDK package manifests, and all non-test client SDK/UI SDK source bytes.
- Client-plugin-contract, contract, and RyotQL source bytes.
- Installed package files for Babel core/syntax plugins, StyleX runtime/plugin, React/ReactDOM,
  Effect, and the TanStack hotkey/store dependencies reached by the trusted UI graph.
- Fontsource stylesheets and WOFF2 bytes.

The graph identity adds engine `stylex-tracer` plus this dependency fingerprint. The caller
fingerprint is hashed into the CSS marker rather than emitted as raw caller text.

### CSS, Reset, Fonts, Assets, And Routing Wrapper

- Production archive output is extracted `plugin.css`; generated JavaScript has no StyleX runtime
  stylesheet injection.
- Dynamic progress width uses one runtime custom property. Browser tests show width changes without
  adding `<style>` elements or stylesheet rules.
- Tracer mode supplies no Tailwind input, SDK Tailwind scan, `theme.css`, or `palette.css`. Browser CSS
  inspection excludes Tailwind, Preflight, old palette/theme markers, `--color-*`, `--bg`, and
  `--accent`.
- The explicit reset sets box sizing, full document/app height, overflow, body margin/font,
  button/input font inheritance, and app isolation.
- Outfit Variable and Lora Variable CSS and nine hashed WOFF2 assets are emitted through existing
  font handling. The benchmark records 205,324 font bytes.
- `client/tracer-mark.svg` is imported from TSX and emitted through the normal content-hashed asset
  path. The benchmark records one 230-byte local asset.
- The normal asset allowlist remains `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`,
  `.ico`, `.woff2`, and `.wasm`, with the contract-owned MIME map.
- The reused routing wrapper still has inline `background: var(--bg)`. The variable is intentionally
  not aliased or supplied by fallback CSS. Its computed background remains transparent. The tracer
  child paints its own full document background and foreground, so the proof remains visible without
  concealing this unresolved dependency.

## Cache Activation And Invalidation

| Boundary           | Evidence and behavior                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Persistent/restart | Real `ClientPagesRepository.findBuild`/`createBuild` and `PluginRepository.persistClientArtifact` methods run over a recording database harness. They create separate StyleX/Tailwind build and artifact rows, reconstruct fresh repository layers, and reuse only the matching row. |
| Build-local memory | Rule arrays, trusted/archived maps, and temporary files are created per compilation. Concurrent StyleX fixtures do not exchange CSS; failure leaves neither rules nor temporary roots for the next build. No new completed-artifact memory cache exists.                             |
| In-flight          | Promise deduplication is keyed by graph hash. Concurrent StyleX and Tailwind requests execute separately. Entries are removed after resolve or reject.                                                                                                                               |
| Failure            | The same repository-method harness records no artifact/build row after compiler failure; a reconstructed layer later stores a fresh StyleX success without Tailwind or stale-artifact fallback.                                                                                      |
| Dependency changes | The expanded fingerprint covers compiler implementation, Bun version/revision, trusted source and dependency closure, lockfile, fonts, contracts, adapter/options/reset, and relevant package files; any covered change updates graph/artifact identity.                             |
| Benchmark          | Direct forced calls report zero cache hits; timing is compilation timing, not persistent reuse timing.                                                                                                                                                                               |

These tests execute the repository methods and SQL-expression construction, but there is no real
PostgreSQL test layer. They do not prove PostgreSQL transaction, constraint, or driver behavior.

## Security Boundaries

The ordinary client allowlist remains exact:

```text
clsx
react
react-dom
react-dom/client
react/jsx-runtime
@ryot-app/client-sdk
@ryot-app/client-sdk/effect
@ryot-app/client-sdk/plugin
@ryot-app/client-sdk/react
@ryot-app/client-sdk/ryotql
@ryot-app/client-sdk/screen
@ryot-app/ryotql-recipes/saved-views
@ryot-app/client-ui-sdk
@ryot-app/client-ui-sdk/icon
@ryot-app/client-ui-sdk/schema-form
@ryot-app/client-ui-sdk/sync
@ryot-app/client-ui-sdk/table
@ryot-app/client-ui-sdk/tint
```

Tracer mode adds only the five imports listed above. Archived `shared/**` remains limited to relative
imports inside `shared/**` and exactly `@ryot-app/plugin-kit/effect`, `/ryotql`, and `/schema`;
StyleX is rejected there. Relative client imports remain inside the contributor's client/shared roots.
Trusted relative imports remain in the approved trusted source map.

An AST preflight parses original `.ts`/`.tsx` before StyleX transformation and checks value imports,
type-only imports, re-exports, side-effect imports, and static dynamic imports. A nonliteral dynamic
import is rejected. This prevents transformation or `@ts-ignore` from erasing an unauthorized import.
Diagnostics retain the logical file and source line/column.

Aggregate source (512 KiB) and per-asset (256 KiB) limits are enforced before temporary source
materialization, including unreachable graph files. Existing limits also remain: 8 MiB artifact,
1 GiB worker memory, 30 seconds, concurrency 2, 100 diagnostics, and 2,000 characters per diagnostic
message. Archived Babel configuration is rejected with `RYOT_CLIENT_STYLEX_CONFIG`; Babel runs with
`babelrc: false` and `configFile: false`. No archived code executes to discover style values.

The installed plugin remains in an iframe with `sandbox="allow-scripts"`, no-referrer policy,
content-addressed artifact URLs, normal CSP, archive validation, and the existing MessagePort
handshake.

## Diagnostics Matrix

| Invalid case                                                 | Detector                                              | Recorded result                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| Type/value/re-export/side-effect/dynamic unauthorized import | Original-source AST preflight plus Ryot import policy | One positioned `RYOT_CLIENT_IMPORT` per source reference before transform |
| Nonliteral dynamic import                                    | Original-source AST preflight                         | Positioned `RYOT_CLIENT_IMPORT`                                           |
| Missing/escaping relative token import                       | Ryot bounded import policy                            | Positioned `RYOT_CLIENT_IMPORT` naming the source specifier               |
| StyleX in archived `shared/**`                               | Ryot shared-source policy                             | `RYOT_CLIENT_IMPORT` on the shared logical file                           |
| Missing token member                                         | TypeScript semantic check                             | Positioned TS diagnostic on author source                                 |
| CSS typo `colour` with `satisfies stylex.CSSProperties`      | TypeScript                                            | `TS2561` at line 3; valid `color` near-neighbor compiles                  |
| Invalid constrained value `position: "absolut"`              | TypeScript                                            | `TS2820` at line 3; valid `absolute` near-neighbor compiles               |
| Unsupported shorthand `border`                               | Upstream StyleX property validation/transform         | Positioned `RYOT_CLIENT_STYLEX`; longhand near-neighbor compiles          |
| Non-static StyleX expression                                 | Upstream StyleX transform                             | Positioned `RYOT_CLIENT_STYLEX`; failure cleanup verified                 |
| Forbidden trial-button `position` override                   | TypeScript against narrow `StyleXStyles` contract     | TS diagnostic on client source; real color/background override passes     |
| Archived Babel configuration                                 | Ryot tracer input policy                              | `RYOT_CLIENT_STYLEX_CONFIG`; file is never executed                       |
| Oversize source/asset before materialization                 | Compiler limits                                       | `RYOT_CLIENT_SOURCE_SIZE` / positioned `RYOT_CLIENT_ASSET_SIZE`           |

This is scoped coverage, not universal CSS type safety. Unconstrained expressions and other CSS
features can be handled by different TypeScript or StyleX layers.

## Accessibility, Lifecycle, And Safe Areas

- Controls retain focus-visible styles, disabled behavior, 44 px minimum targets, placeholder/error
  semantics, progress ARIA values, and reduced-motion overrides for button/progress transitions.
- Browser tests verify focus/placeholder computed styles and zero-duration transitions under
  `prefers-reduced-motion: reduce` on both surfaces and engines.
- Details uses the shared focus trap, inert-background, focus-restore, scroll-lock, `OverlayScope`
  Escape, and document Back path. Unit coverage verifies initial close-button focus, forward/reverse
  Tab trapping, inert siblings, locked body overflow, Escape cleanup, and focus restoration; shared
  overlay tests cover document Back ordering/restoration.
- Nested plugin/portal backgrounds now remain inert while an inner overlay is active without making
  the active foreground subtree inert. Shared overlay and modal tests cover nested paths, stacked and
  overlapping overlays, pre-existing inert state, release ordering, and restoration.
- Theme/viewport changes preserve panel and open-dialog state. Leaving removes the iframe, dialog,
  portal state, inert/scroll effects, and bridge; re-entry creates a fresh artifact session and one
  bridge with reset panel state.
- Browser safe-area evidence patches only the shell's hidden platform detector because desktop
  browsers cannot set nonzero `env(safe-area-inset-*)`. Values then follow the production detector to
  shell to plugin bridge path. Unit tests inject shell-chrome numbers directly into the panel props.
  Neither path fakes panel padding or bypasses safe-area arithmetic.

## Browser Evidence

Native Chromium 151.0.7922.34 passed in 7.039 seconds and the native WebKit 26.5 browser-engine binary
passed in 7.427 seconds: 2/2 final local Playwright tests passed. This local two-engine result is the
acceptance gate. It means native browser engines under Playwright, not native Ryot mobile apps. Native
iOS and Android were not run.

The ordinary client-plugin E2E regression also passed 1/1 in 14.869 seconds.

Both engines cover kernel and archive surfaces, light/dark, wide/compact, state and dialog
preservation, field/error/disabled/focus/placeholder states, permitted override, progress/reduced
motion, portal themes, safe-area flow, dynamic CSS rule stability, iframe sandbox/handshake/session
lifecycle, local asset/fonts, Tailwind exclusion, and transparent `var(--bg)` wrapper behavior.
The four Chromium screenshots were regenerated by the final local run. WebKit is assertion-only.

| Screenshot                                                            |       Size |
| --------------------------------------------------------------------- | ---------: |
| [Kernel desktop light](evidence/screenshots/kernel-desktop-light.png) | 1280 x 900 |
| [Kernel desktop dark](evidence/screenshots/kernel-desktop-dark.png)   | 1280 x 900 |
| [Plugin mobile light](evidence/screenshots/plugin-mobile-light.png)   |  390 x 844 |
| [Plugin mobile dark](evidence/screenshots/plugin-mobile-dark.png)     |  390 x 844 |

### Cloudflare Live Evidence

`https://ryot-testing.ignisda.me` was pointed through Cloudflare to the Vite development client on
port 3005. A separate real backend was started with `RYOT_STYLEX_TRACER=1`; the Vite client was also
started with that flag. Docker provided healthy PostgreSQL, Redis, and object storage.

The live root, both tracer routes, and backend health endpoint returned HTTP 200:

```text
https://ryot-testing.ignisda.me/
https://ryot-testing.ignisda.me/stylex-tracer-kernel
https://ryot-testing.ignisda.me/stylex-tracer
https://ryot-testing.ignisda.me/api/system/health
```

Chromium 151.0.7922.34 completed the full live tracer suite in 29.6 seconds. WebKit 26.5 reached the
tunnel with HTTP 200 and completed the tracer assertions, but two runs timed out only on the final
history re-entry because Cloudflare did not complete the WebKit page load. This is tunnel-specific
transport evidence, not a failed local acceptance gate: the full local native WebKit suite passes.
The backend recorded no 5xx responses, and the Vite log contained no error-like entries. The uploaded
archive SHA-256 remained
`0736e2d3b3c0b58c5619122d7c957ff512ccd37054d480d833bf9d0484b18c0c`.

The secret-free live command record is:

```sh
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
RYOT_STYLEX_TRACER=1 bun run --cwd apps/server src/main.ts
RYOT_STYLEX_TRACER=1 bun run --cwd kernel/client dev -- --host 127.0.0.1
cloudflared tunnel --url http://127.0.0.1:3005 run "$CLOUDFLARE_TUNNEL"
curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://ryot-testing.ignisda.me/
curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://ryot-testing.ignisda.me/stylex-tracer-kernel
curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://ryot-testing.ignisda.me/stylex-tracer
curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://ryot-testing.ignisda.me/api/system/health
```

Tunnel credentials and backend connection values were supplied through the environment and are not
printed. After verification, the backend, Vite, and tunnel processes were stopped. PostgreSQL, Redis,
and object storage were intentionally left running and healthy.

## Latest Benchmark

Environment: Mac16,12, arm64, 10 logical CPUs, 17,179,869,184 bytes memory; macOS 26.3.1; Bun
1.4.0; StyleX/Babel plugin 0.19.0; Tailwind CSS 4.3.0; dirty worktree at base
`5228cc84a29d98283800f90b39434825a407f51a`. Selected diff SHA-256:
`f7487b03f34af3507d1b6795c6a634780b6ae0472f7919e11348affa2d87f331`; stable inventory SHA-256:
`958a931ba052d245e9dad8a084c4e1c58abfae67829ac42c6b629df054833d19`.

StyleX artifact identity/hash:
`91ffd7ad4efbe238d7c93760c278ecb46fb33f4fb415d227f316c82736b0d45a` /
`3546a6d1e1b6ef2e781277c472d80e63abbad941fc2443c76dcbde9cc17a2516`. Tailwind artifact
identity/hash: `04624a90b81bc8bed1bf8555a478efedf5653a9ca5f568898c02300179739df7` /
`3d67c14e70e7ae096e1167de22d9e048ff0c6b0dfbd980dea29db922ffaae947`.

| Variant  |         JS raw/gzip |     CSS raw/gzip | Full artifact | Source archive |   Cold wall | Warm forced compilations (ms)                    |               Cold/warm RSS |
| -------- | ------------------: | ---------------: | ------------: | -------------: | ----------: | ------------------------------------------------ | --------------------------: |
| StyleX   | 605,879 / 188,835 B | 11,402 / 4,241 B |     823,373 B |        2,260 B | 1,868.79 ms | 1,527.32, 1,524.73, 1,516.40, 1,525.59, 1,508.21 | 660,897,792 / 670,400,512 B |
| Tailwind | 597,595 / 185,327 B | 44,586 / 9,853 B |     848,273 B |        4,571 B |   851.55 ms | 667.84, 634.97, 638.94, 634.10, 647.82           | 385,089,536 / 426,098,688 B |

Warm medians were 1,524.728209 ms and 638.941583 ms: StyleX was 2.38633x in this run. StyleX was
33,184 raw CSS bytes smaller, 8,284 raw JavaScript bytes larger, and 24,900 bytes smaller overall. Both variants
had identical 205,324-byte fonts and one 230-byte local asset. Repeated and distinct-cwd artifacts and
canonical archives were byte-identical; archive reader checks passed; cache hits were zero.

### Seven Direct Dependency Additions

| Dependency                        | Version | Declaring manifest(s)                                |
| --------------------------------- | ------- | ---------------------------------------------------- |
| `@stylexjs/stylex`                | 0.19.0  | client-plugin compiler, client UI SDK, tracer plugin |
| `@stylexjs/babel-plugin`          | 0.19.0  | client-plugin compiler                               |
| `@stylexjs/unplugin`              | 0.19.0  | kernel client                                        |
| `@babel/core`                     | 7.29.0  | client-plugin compiler                               |
| `@babel/plugin-syntax-jsx`        | 7.28.6  | client-plugin compiler                               |
| `@babel/plugin-syntax-typescript` | 7.28.6  | client-plugin compiler                               |
| `@types/babel__core`              | 7.20.5  | client-plugin compiler                               |

All seven exact installed versions occur in `bun.lock`. Transitive dependencies are excluded.

### Attributed Integration Source

| Area                           | Lines | UTF-8 bytes |
| ------------------------------ | ----: | ----------: |
| Compiler                       | 1,096 |      37,230 |
| CLI activation                 |    29 |       1,069 |
| Backend activation/composition |   115 |       4,249 |
| Kernel Vite/route adapter      |    89 |       3,147 |
| Shared UI                      |   507 |      15,172 |
| Plugin                         |   195 |       5,161 |

Tracer-only files use full current content. Existing mixed files use additions versus the base and can
include concurrent additions. Tests, generated routes, screenshots, reports, and benchmark code are
excluded. The result inventory remained stable during measurement.

## Limitations And Recommendation

- The unresolved routing wrapper `var(--bg)` remains transparent. The child document compensates by
  painting itself; there is no alias or fallback.
- No manual source edit/HMR cycle was proved.
- Repository persistence tests use real repository methods over a recording database interface, not a
  real PostgreSQL test layer.
- The fixture is one panel, not a representative product migration or full StyleX/CSS feature test.
- Firefox, native Safari, native iOS, and native Android were not run.
- Cloudflare twice failed to complete only WebKit's final history re-entry load; all preceding live
  assertions and the full local WebKit gate passed.
- Benchmark filesystem caches, thermal state, and background load were uncontrolled. StyleX ran
  first; RSS is whole worker; distinct-cwd runs still use one checkout.
- Running two styling engines and maintaining the bounded Babel adapter add dependency and integration
  cost.

**Recommendation: investigate further.** The tracer proves technical feasibility for the bounded
case, but performance, memory, integration size, HMR, product-scale authoring, and native-client gaps
do not support adoption yet. This recommendation is not permission to migrate.

## Retain Or Delete

| Disposition             | Inventory                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retain candidate        | Shared controls/panel/tokens, only if a later approved design generalizes them                                                                                                                                |
| Retain candidate        | Official Babel transform/rule extraction, canonical identity, expanded fingerprint, original-import preflight, limits, positioned diagnostics, and cache tests if archived StyleX remains under investigation |
| Delete after evaluation | `plugins/stylex-tracer/**`, archive, and screenshots                                                                                                                                                          |
| Delete after evaluation | `/stylex-tracer-kernel` route/gate/screen/tests, Vite gate, and generated route entry                                                                                                                         |
| Delete after evaluation | `RYOT_STYLEX_TRACER` CLI/backend activation, exact-slug branches, protocol field, tracer imports, adapter, and declarations                                                                                   |
| Delete after evaluation | `RUN_STYLEX_TRACER_E2E`, installer, browser suite, and benchmark tree/results                                                                                                                                 |
