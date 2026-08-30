# Ryot StyleX Tracer Evaluation Report

## Recommendation

**Investigate further.** The final tracer proves that shared StyleX components and tokens can compile
through the opt-in kernel Vite build and Ryot's canonical archived-plugin path, remain independent of
Tailwind in the child document, produce deterministic artifacts, preserve security limits, and behave
correctly in native Chromium and WebKit browser engines under Playwright.

It does not justify adoption. The archive path needs a bounded custom Babel adapter, the latest small
fixture benchmark remains slower and uses more whole-worker memory than Tailwind, integration scope is
material, one routing wrapper variable remains unresolved, HMR was not manually proved, and
product-scale/native-app evidence is absent. This recommendation is **not permission to migrate**,
start a cutover, or make StyleX the repository standard.

## Objective, Scope, And Base

The objective was to evaluate one shared panel in two real environments: the kernel Vite client and a
canonically built, uploaded, installed, prepared, and sandboxed client plugin. The experiment had to
use shared source/tokens, extracted production CSS, the normal artifact/session/MessagePort path,
strict import and resource boundaries, reproducible cache identity, useful diagnostics, browser
evidence, and an equivalent local Tailwind benchmark.

| Item                          | Value                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Implementation base           | `5228cc84a29d98283800f90b39434825a407f51a` (`ultra-rewrite`, `chore: add stylex tracer`) |
| Brief reference               | `ee4ea35c776c8118e90371293a83d0edc77eb7ec`; superseded by the actual base above          |
| State                         | Dirty uncommitted evaluation worktree                                                    |
| StyleX                        | Runtime, Babel plugin, and unplugin 0.19.0                                               |
| Toolchain                     | Bun 1.4.0; TypeScript 7.0.2; Babel 7.29.0; Vite 8.0.14; Vitest 4.1.9                     |
| Routes                        | Kernel `/stylex-tracer-kernel`; canonical plugin `/stylex-tracer`                        |
| Canonical E2E archive SHA-256 | `0736e2d3b3c0b58c5619122d7c957ff512ccd37054d480d833bf9d0484b18c0c`                       |

Excluded from migration scope: existing media/fitness screens, existing shared controls, the kernel
shell, normal navigation, the full palette, production data, public manifest/protocol strategy fields,
and broad existing-UI rewrites.

## Implementation By Area

| Area          | Final implementation                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared UI     | Explicit tracer-only UI SDK exports contain two constrained controls, panel state, themes/tokens, progress, and an accessible portal dialog.                                                                                      |
| Kernel        | Build-time environment gate conditionally adds the official StyleX Vite plugin and exposes `/stylex-tracer-kernel`; Turbo keys builds on the flag, and direct production builds prove disabled output omits the tracer chunk/CSS. |
| Plugin        | Client-only manifest declares canonical root route; thin adapter uses normal router/theme/viewport/safe-area/floating-root services, local token, SVG, and full document paint.                                                   |
| Compiler      | Original-source import preflight, exact import policy, pre-materialization limits, bounded temporary filesystem, official Babel transform/rule extraction, positioned diagnostics, extracted CSS, and cleanup.                    |
| Identity      | Expanded dependency fingerprint includes compiler implementation, Bun version/revision, lockfile, package files/manifests, trusted SDKs/dependencies, contracts/RyotQL, fonts, options, and reset.                                |
| Backend/cache | Exact-slug activation reaches installation/page preparation; graph identity separates engines; real repository methods cover separate recorded rows, reconstruction, and failure cleanup without a real PostgreSQL layer.         |
| CLI/archive   | Canonical build opts in only for exact slug, compiles before writing, and writes the archive later uploaded unchanged by E2E.                                                                                                     |
| Browser       | Opt-in E2E installs the archive, verifies both routes and lifecycle in Chromium/WebKit, and captures Chromium screenshots. A normal client-plugin E2E regression also passes.                                                     |
| Benchmark     | Production graph path compares StyleX with a benchmark-local equivalent Tailwind fixture and records sizes, cold/warm times, RSS, reproducibility, seven direct dependencies, and attributed integration source.                  |

## Architecture And Decisions

### Opt-In Kernel And Routes

`kernel/client/vite.config.ts` reads `RYOT_STYLEX_TRACER === "1"`. Only then does it add
`@stylexjs/unplugin/vite` and define `__RYOT_STYLEX_TRACER__` true. The route's `beforeLoad` rejects a
disabled build with TanStack Router not-found. When enabled, plugin order is StyleX, devtools,
Tailwind, TanStack Router, React.

Turbo's `build` task declares `RYOT_STYLEX_TRACER` as an environment input. The direct Vite
production-artifact test builds both states: disabled output has no `stylex-tracer-screen` chunk or
`ryot-stylex-tracer` CSS marker, while opt-in output contains both.

The routes are intentionally distinct:

| Route                   | Owner                                           |
| ----------------------- | ----------------------------------------------- |
| `/stylex-tracer-kernel` | Opt-in kernel comparison route                  |
| `/stylex-tracer`        | Plugin manifest root route under canonical slug |

E2E reads the canonical zip, validates it with `readPluginArchive`, and passes the decoded package
unchanged to `installPrivatePluginPackage`. The earlier test-only `/e2e` manifest rewrite was removed.

### Shared Panel And Environment Authority

The kernel and plugin render the same `StyleXTracerPanel` and SDK token source. The kernel adapter
reads theme, compact mode, safe-area values, and shell chrome; it creates a body-level portal root.
The plugin adapter receives the corresponding authority over the existing bridge and uses the normal
plugin floating root. Only adapters differ. The plugin additionally imports archive-local
`tokens.stylex.ts` to exercise local `defineVars` identity.

The panel preserves name, progress, and open dialog state across theme and viewport changes. Its
dialog uses shared `useFocusTrap`, `useInertBackground`, `useRestoreFocus`, `useScrollLock`, and
`OverlayScope` Escape/Back behavior. Buttons and progress disable transition duration for reduced
motion. The controls do not admit caller `className` or inline `style`; the button's StyleX override
is limited to `color` and `backgroundColor`.

### Upstream Integrations

Kernel Vite uses `@stylexjs/unplugin/vite@0.19.0` with:

```text
devMode: "full"
runtimeInjection: false
useCSSLayers.prefix: "ryot-stylex-tracer"
useCSSLayers.before: ["theme", "base", "components", "utilities"]
unstable_moduleResolution.type: "commonJS"
unstable_moduleResolution.rootDir: <repository root>
unstable_moduleResolution.themeFileExtension: ".stylex"
```

Archive production uses Babel syntax TypeScript, syntax JSX, then
`@stylexjs/babel-plugin@0.19.0`, with:

```text
dev: false
test: false
runtimeInjection: false
treeshakeCompensation: true
importSources: ["@stylexjs/stylex"]
propertyValidationMode: "throw"
styleResolution: "property-specificity"
```

Official `processStylexRules` emits `ryot-stylex` layers after `ryot-tracer-reset`.

### Official Bun Adapter Incompatibility

The installed upstream Bun adapter's broad `onLoad` reads `Bun.file(args.path)`. Ryot composes
authorized archive bytes, contributor namespaces, and public-export maps in virtual modules; allowing
the adapter to resolve arbitrary host paths would violate that boundary. It also writes CSS to
`dist/stylex.dev.css` relative to process cwd and ignores write errors, while Ryot must return
deterministic `plugin.css` through its immutable content-addressed artifact.

The bounded adapter uses official Babel and StyleX rule processing rather than a fork. It writes only
authorized archived TypeScript to a temporary root, uses custom canonical resolution, transforms
reachable archive and approved trusted modules, keeps rules build-local, emits through the existing
artifact model, and removes temporary files after success/failure.

### Module And Token Identity

Tracer-only bare modules are exactly:

```text
@stylexjs/stylex
@ryot-app/client-ui-sdk/overlay
@ryot-app/client-ui-sdk/shortcut
@ryot-app/client-ui-sdk/stylex-tracer
@ryot-app/client-ui-sdk/stylex-tracer/tokens.stylex
```

Canonical archive paths use `/__ryot_stylex__/...`; trusted paths use
`/__ryot_stylex__/trusted/stylex-tracer/...`. Neither class nor variable identity includes checkout,
process cwd, or temporary root.

### Expanded Dependency Fingerprint

The final fingerprint hashes sorted identifiers/content hashes for:

- Adapter/options/reset identity and exact Babel/StyleX/font versions.
- The client-plugin compiler implementation files and the exact `Bun.version`/`Bun.revision` pair.
- `bun.lock`.
- Client SDK and UI SDK package manifests and all non-test TS/TSX/JS/JSX sources.
- Client-plugin-contract, contract, and RyotQL sources.
- Installed package files for Babel core/syntax plugins, StyleX runtime/plugin, Effect,
  React/ReactDOM, and TanStack hotkeys/react-hotkeys/store.
- Fontsource `index.css` and WOFF2 files.

A unit test proves a trusted source hash changes the derived build fingerprint. The backend includes
engine plus dependency fingerprint in graph identity, so a dependency-only change invalidates
persistent and in-flight reuse before compilation.

### Output, Fonts, Assets, And Reset

The generated artifact remains `plugin.js`, `plugin.css`, hashed assets, then `index.html`. Production
uses extracted CSS and no `stylex-inject` runtime. Runtime progress uses a CSS custom property without
adding stylesheet rules/elements.

Tracer dependency resolution deliberately supplies empty Tailwind input, UI/client SDK Tailwind scan,
`theme.css`, and `palette.css`. The child gets the existing Outfit/Lora Fontsource CSS and nine WOFF2
files, an explicit document reset, and StyleX output. The local SVG uses the existing MIME/hash/URL/CSP
path. The reset covers box sizing, document/app dimensions and overflow, body margin/font,
button/input inheritance, and app isolation.

### Genuine Routing Limitation

The reused plugin routing wrapper still emits inline `background: var(--bg)`. Because tracer mode does
not load the legacy theme/palette, `--bg` is unresolved and the wrapper computes transparent. This was
not hidden with an alias, compatibility declaration, or fallback. The tracer child paints its own
full document foreground/background, so the panel is correct while the wrapper dependency remains a
recorded migration issue.

## Security And Diagnostics

### Exact Import Policy

Ordinary client bare imports remain:

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

Only tracer mode adds the five tracer modules above. `shared/**` remains limited to relative shared
files and `@ryot-app/plugin-kit/{effect,ryotql,schema}`. StyleX remains forbidden in shared source.
Client relative imports remain within that contributor's client/shared roots; trusted relative imports
must resolve in the approved trusted map.

### Original-Source Preflight And Limits

Before StyleX can transform or erase syntax, Babel parser preflight walks original `.ts`/`.tsx` and
checks imports, type imports, exports from, side-effect imports, and dynamic imports. `@ts-ignore`
cannot bypass this policy. Dynamic imports require string literals. Every rejected reference gets a
logical author file and one-based line/column.

Before temporary materialization, the compiler charges all graph source bytes and each asset,
including unreachable files. Final limits are:

| Limit              |            Value |
| ------------------ | ---------------: |
| Aggregate source   |          512 KiB |
| Per asset          |          256 KiB |
| Artifact           |            8 MiB |
| Worker memory      |            1 GiB |
| Timeout            |       30 seconds |
| Concurrency        |                2 |
| Diagnostic count   |              100 |
| Diagnostic message | 2,000 characters |

Archived Babel config is rejected and never executed; Babel discovery is disabled. Existing archive,
artifact, iframe sandbox/no-referrer, CSP, MIME, session, and MessagePort validation remain active.

### Detector Matrix

| Invalid input                                                       | Detector layer                                | Final evidence                                                           |
| ------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| Unauthorized type/value/re-export/side-effect/static dynamic import | Original-source AST preflight and Ryot policy | Four separate positioned `RYOT_CLIENT_IMPORT` diagnostics in one fixture |
| Nonliteral dynamic import                                           | Original-source AST preflight                 | Positioned `RYOT_CLIENT_IMPORT`                                          |
| Missing/escaping token path                                         | Bounded Ryot resolver/policy                  | Positioned `RYOT_CLIENT_IMPORT` at import specifier                      |
| StyleX in `shared/**`                                               | Shared import policy                          | `RYOT_CLIENT_IMPORT` on logical shared source                            |
| Missing token member                                                | TypeScript                                    | Positioned TS diagnostic                                                 |
| `colour` typo under `satisfies CSSProperties`                       | TypeScript                                    | `TS2561`, line 3; valid `color` near-neighbor                            |
| `position: "absolut"` under `satisfies CSSProperties`               | TypeScript                                    | `TS2820`, line 3; valid `absolute` near-neighbor                         |
| Unsupported `border` shorthand                                      | StyleX validation/transform                   | Positioned `RYOT_CLIENT_STYLEX`; supported longhands are near-neighbor   |
| Non-static expression                                               | StyleX transform                              | Positioned `RYOT_CLIENT_STYLEX`; no later contamination/temp leak        |
| Forbidden component `position` override                             | TypeScript narrow override contract           | TS diagnostic; permitted color/background usage passes                   |
| Archived Babel configuration                                        | Ryot tracer config policy                     | `RYOT_CLIENT_STYLEX_CONFIG`; no execution                                |
| Oversize graph/asset                                                | Pre-materialization limits                    | `RYOT_CLIENT_SOURCE_SIZE` / positioned `RYOT_CLIENT_ASSET_SIZE`          |

This matrix does not prove universal CSS type safety. Detection depends on author constraints,
TypeScript definitions, and upstream StyleX validation.

## Cache Coverage

| Boundary                    | Test and result                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Persistent/restart          | Real repository methods over a recording database harness store separate Tailwind/StyleX artifact and build rows. Fresh repository layers reconstruct lookup state and reuse only matching graph rows. |
| In-flight engine separation | Concurrent StyleX/Tailwind graphs both reach compilation and return distinct artifacts.                                                                                                                |
| Build-local StyleX memory   | Concurrent StyleX fixture colors stay isolated; failed rule collection does not appear in the next success.                                                                                            |
| Failure persistence         | The repository-method harness records no artifact/build row after failure. A fresh layer later stores a new StyleX artifact with no Tailwind fallback.                                                 |
| Dependency invalidation     | Compiler implementation, Bun version/revision, and dependency inputs participate in the fingerprint; covered changes produce different graph/artifact identities.                                      |
| Cleanup                     | Failed transform restores the preexisting temporary-directory set. In-flight promise is removed on both success/rejection.                                                                             |
| Ordinary isolation          | Ordinary mode rejects StyleX and tracer overlay modules instead of accepting or falling back.                                                                                                          |

The persistence tests exercise `ClientPagesRepository.findBuild`/`createBuild` and
`PluginRepository.persistClientArtifact`, including SQL-expression construction and transaction
composition, through a recording `Database` implementation. No real PostgreSQL test layer exists, so
these tests do not verify PostgreSQL constraints, transaction semantics, or driver behavior.

## Accessibility, Lifecycle, And Safe Areas

| Behavior              | Evidence                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focus/field           | Browser computed focus border/outline and placeholder color/opacity; unit initial focus and invalid/error/disabled/reset behavior                                      |
| Dialog trap           | Unit forward and reverse Tab remain on the only close control                                                                                                          |
| Inert and scroll lock | Shared tests verify nested plugin/portal paths, stacked/overlapping overlays, foreground exemption, pre-existing inert state, release ordering, and scroll restoration |
| Focus restoration     | Unit and browser verify close returns focus to Details                                                                                                                 |
| Escape and Back       | Tracer uses `OverlayScope`; unit verifies Escape cleanup; existing overlay-scope/modal tests verify document Back LIFO dismissal and focus restoration                 |
| Reduced motion        | Both browser engines verify button and progress transition duration becomes effectively zero                                                                           |
| Theme/viewport        | Open dialogs and panel state survive light/dark and compact/wide updates                                                                                               |
| Leave/re-enter        | Old iframe/dialog/portal effects disappear; re-entry has reset state, one document, fresh session URL, and one bridge                                                  |

Safe-area browser evidence does not write panel padding. Desktop browser engines cannot configure
nonzero `env(safe-area-inset-*)`, so E2E patches only the shell's hidden platform detector. Values
then travel through the production detector, shell state, and plugin bridge. The scoped unit test
injects shell-chrome values directly as panel inputs and checks arithmetic. These are browser/unit
evidence, not native-device safe-area evidence.

## Section 8 Acceptance Matrix

| Check                      | Status                       | Final evidence/qualification                                                                                                                                                                                                |
| -------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel development         | Partial                      | Official gated Vite development configuration and scoped tests exist. No manual source edit/HMR invalidation cycle was recorded; do not claim HMR.                                                                          |
| Kernel production          | Pass                         | Turbo keys builds on `RYOT_STYLEX_TRACER`; direct Vite production builds prove disabled output has no tracer screen chunk/StyleX CSS and opt-in output has both.                                                            |
| Archived plugin            | Pass                         | Canonical unchanged archive SHA above was validated, uploaded, installed/prepared, served in sandboxed iframe, and completed real handshake.                                                                                |
| Tailwind independence      | Pass for tracer child        | Compiler inputs omit Tailwind/theme/palette and browser CSS audit/computed styles pass. Kernel shell remains Tailwind. Unresolved wrapper `var(--bg)` stays transparent and documented.                                     |
| Shared-source extraction   | Pass                         | Both surfaces use one SDK panel/token source; shared declaration effects and archive-local token are present in extracted/browser CSS without copies.                                                                       |
| Custom client page         | Pass                         | `application: "page"` uses normal generated single-root bootstrap, CSS, asset output, and final document; benchmark exercises production graph path.                                                                        |
| Appearance and interaction | Pass for Chromium/WebKit     | Both native browser engines cover both surfaces, light/dark, wide/compact, field/focus/error/disabled states, permitted override, progress, reduced motion, portal theme, and safe-area flow.                               |
| Dynamic CSS                | Pass                         | Progress changes visually while style-element and stylesheet-rule counts remain stable; no runtime injector.                                                                                                                |
| Lifecycle                  | Pass                         | Theme/viewport preserve state/dialog; nested plugin backgrounds remain inert without inerting the active foreground; leave/re-entry cleans resources and creates a fresh session/bridge.                                    |
| Reproducibility            | Pass                         | Repeated and distinct-cwd generated artifacts and canonical archives are byte-identical; inventory was stable during benchmark.                                                                                             |
| Isolation and invalidation | Pass for tested boundaries   | Original-source policy, compiler/Bun fingerprinting, build-local/in-flight isolation, and real repository methods over a recording DB harness cover separate rows/reconstruction/failure cleanup; no real PostgreSQL layer. |
| Existing behavior          | Pass for relevant regression | Relevant checks pass and normal `src/browser/client-plugin.test.ts` passed 1/1 in 14.869 seconds. Full repository/E2E suite was not run.                                                                                    |

## Browser Matrix And Screenshots

| Engine                                  | Version       | Kernel  | Plugin  | Notes                                   |
| --------------------------------------- | ------------- | ------- | ------- | --------------------------------------- |
| Native Chromium binary under Playwright | 151.0.7922.34 | Pass    | Pass    | 7.039 s; regenerated four screenshots   |
| Native WebKit binary under Playwright   | 26.5          | Pass    | Pass    | 7.427 s; assertion-only                 |
| Native iOS app/device                   | Not run       | Not run | Not run | Browser viewport is not native evidence |
| Native Android app/device               | Not run       | Not run | Not run | Browser viewport is not native evidence |

| Screenshot                                                                                     | Dimensions |
| ---------------------------------------------------------------------------------------------- | ---------: |
| [Kernel desktop light](../plugins/stylex-tracer/evidence/screenshots/kernel-desktop-light.png) | 1280 x 900 |
| [Kernel desktop dark](../plugins/stylex-tracer/evidence/screenshots/kernel-desktop-dark.png)   | 1280 x 900 |
| [Plugin mobile light](../plugins/stylex-tracer/evidence/screenshots/plugin-mobile-light.png)   |  390 x 844 |
| [Plugin mobile dark](../plugins/stylex-tracer/evidence/screenshots/plugin-mobile-dark.png)     |  390 x 844 |

Chromium captures wait for Outfit/Lora. The four screenshots were regenerated in the final local 2/2
run. The 390 x 844 viewport is browser evidence only.

## Cloudflare Live Evidence

### Topology And Health

`https://ryot-testing.ignisda.me` was pointed through Cloudflare to the Vite development client on
port 3005. The live setup used a separate real backend with `RYOT_STYLEX_TRACER=1`, a Vite client
started with the same flag, and healthy Docker containers for PostgreSQL, Redis, and object storage.

| Live request                                           | Result   |
| ------------------------------------------------------ | -------- |
| `https://ryot-testing.ignisda.me/`                     | HTTP 200 |
| `https://ryot-testing.ignisda.me/stylex-tracer-kernel` | HTTP 200 |
| `https://ryot-testing.ignisda.me/stylex-tracer`        | HTTP 200 |
| `https://ryot-testing.ignisda.me/api/system/health`    | HTTP 200 |

The backend recorded no 5xx responses. The Vite log contained no error-like entries. The canonical
archive SHA-256 remained
`0736e2d3b3c0b58c5619122d7c957ff512ccd37054d480d833bf9d0484b18c0c`.

### Local Gate Versus Tunnel Transport

The acceptance gate remains the full local suite: native Chromium 151.0.7922.34 and native WebKit
26.5 both pass locally.

| Environment                        | Result                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare, Chromium 151.0.7922.34 | Full tracer suite passed in 29.6 seconds                                                                                                       |
| Cloudflare, WebKit 26.5, run 1     | Tunnel returned HTTP 200 and tracer assertions completed; final history re-entry timed out because Cloudflare did not complete the WebKit load |
| Cloudflare, WebKit 26.5, run 2     | Same tunnel-only timeout at the final history re-entry after tracer assertions completed                                                       |
| Local, WebKit 26.5                 | Full suite passed; acceptance gate remains green                                                                                               |

The two runs produced the same WebKit live result: a tunnel-specific transport timeout. It is not a
tracer assertion failure, a backend 5xx, a Vite error, or a local WebKit acceptance failure. The full
local native WebKit suite passes. Native iOS and Android were not run.

### Secret-Free Live Commands

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

Tunnel credentials and backend connection values were supplied through environment variables and are
not shown. The Chromium and WebKit runs used the same complete tracer assertion sequence against the
live origin; no reduced tunnel-only assertion set was used.

After the live verification, the backend, Vite, and Cloudflare tunnel processes were stopped.
PostgreSQL, Redis, and object storage were intentionally left running and healthy.

## Commands And Results

| Command                                                                                                                                                                                                                                                                                                              | Current result                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install`                                                                                                                                                                                                                                                                                                        | Required setup; exact dependency versions and lockfile presence are recorded by benchmark.                                                |
| `bun run --cwd plugins/stylex-tracer check`                                                                                                                                                                                                                                                                          | Package check command; final aggregate package checks report TypeScript/Oxfmt/Oxlint green.                                               |
| `bun run --cwd plugins/stylex-tracer build`                                                                                                                                                                                                                                                                          | Pass; generated canonical zip uploaded unchanged; SHA-256 `0736e2d3b3c0b58c5619122d7c957ff512ccd37054d480d833bf9d0484b18c0c`.             |
| `bun turbo --filter=@ryot-app/client-plugin-compiler test`                                                                                                                                                                                                                                                           | Pass in final scoped verification; covers preflight, limits, extraction, diagnostics, determinism, concurrency, cleanup, and no fallback. |
| `bun turbo --filter=@ryot-app/cli test`                                                                                                                                                                                                                                                                              | Pass in final scoped verification; covers enabled canonical build, disabled mode, and wrong-slug rejection.                               |
| `bun turbo --filter=@ryot-app/kernel-backend test --only -- 'src/modules/client-pages/graph.test.ts' 'src/modules/client-pages/service-cache.test.ts' 'src/modules/client-pages/repository-cache.test.ts' 'src/modules/plugins/installation-service.test.ts' 'src/modules/plugins/stylex-tracer-activation.test.ts'` | Pass; includes real repository-method persistence/reconstruction/failure tests over a recording database harness.                         |
| `bun --bun run --cwd kernel/client vitest run 'src/routes/_authenticated/-stylex-tracer-kernel-gate.test.ts'`                                                                                                                                                                                                        | Pass; route enabled/disabled gate covered.                                                                                                |
| `bun --bun run --cwd kernel/client vitest run 'src/routes/_authenticated/-stylex-tracer-build.test.ts'`                                                                                                                                                                                                              | Pass; direct disabled Vite production output omits tracer screen/CSS and opt-in output contains both.                                     |
| `bun --bun run --cwd kernel/client vitest run --config src/routes/_authenticated/-stylex-tracer.vitest.config.ts`                                                                                                                                                                                                    | Pass; panel state, safe-area arithmetic, portal, trap, inert, scroll lock, cleanup, field/error/reset covered.                            |
| `RYOT_STYLEX_TRACER=1 bun turbo --env-mode=loose --filter=@ryot-app/kernel-client build`                                                                                                                                                                                                                             | Pass; Vite 8.0.14 transformed 3,213 modules and built in 1.41 s. Warnings below.                                                          |
| `RUN_STYLEX_TRACER_E2E=1 bun turbo --env-mode=loose --filter=@ryot-app/e2e test --only -- 'src/browser/stylex-tracer.test.ts'`                                                                                                                                                                                       | Pass 2/2 locally: Chromium 151.0.7922.34 in 7.039 s and WebKit 26.5 in 7.427 s; screenshots regenerated.                                  |
| `bun turbo --filter=@ryot-app/e2e test --only -- 'src/browser/client-plugin.test.ts'`                                                                                                                                                                                                                                | Pass 1/1 in 14.869 s.                                                                                                                     |
| `bun benchmarks/stylex-tracer/run.ts`                                                                                                                                                                                                                                                                                | Pass; current schema v2 JSON/Markdown generated at 2026-09-09 05:05 local time; source inventory stable.                                  |
| `bun x oxfmt e2e/global-setup.ts e2e/README.md e2e/src/browser/stylex-tracer.test.ts e2e/src/fixtures/plugins/stylex-tracer/index.ts e2e/src/fixtures/plugins/stylex-tracer/plugin.ts` plus scoped Oxlint/TypeScript/diff check                                                                                      | Pass in E2E final review; Oxfmt handled five files and lint reported zero warnings/errors.                                                |

`bun turbo --filter=@ryot-app/client-plugin-compiler check` passes after the tracer-owned Babel
declarations were fixed. `bun turbo --filter=@ryot-app/kernel-backend check` is blocked only by two
pre-existing `TS2552` `RequestInfo` errors in
`kernel/backend/src/lib/infrastructure/pro-key.test.ts` at lines 21 and 29; the tracer-owned Babel
declarations are clean. CLI, client UI SDK, and E2E checks report zero lint warnings/errors. The
backend architecture and preceding full-check stages pass before TypeScript reaches those errors.

### First Failed E2E Installation And Fix

The first retained E2E installation failure returned `PluginRequestError` with reason
`compilation-failed`. Installation-time precompile used ordinary mode and produced four
`RYOT_CLIENT_IMPORT` diagnostics:

- `client/page.tsx`: tracer UI module rejected.
- `client/page.tsx`: tracer token module rejected.
- `client/page.tsx`: `@stylexjs/stylex` rejected.
- `client/tokens.stylex.ts`: `@stylexjs/stylex` rejected.

The CLI had compiled the archive in tracer mode, but installation independently precompiles client
exports. The fix injects `StyleXTracerActivation` into `PluginInstallationService` and wraps the
compiler only when enabled and the manifest slug is exactly `stylex-tracer`, passing the current
dependency fingerprint. A similarly named slug remains ordinary. No ordinary allowlist was broadened.
The unchanged canonical archive then installed and both engines passed.

## Latest Benchmark Results

### Environment And Method

| Field                | Value                                                                           |
| -------------------- | ------------------------------------------------------------------------------- |
| Machine              | Mac16,12, arm64, 10 logical CPUs, 17,179,869,184 bytes memory                   |
| OS                   | macOS 26.3.1                                                                    |
| Toolchain            | Bun 1.4.0; StyleX/Babel plugin 0.19.0; Tailwind CSS 4.3.0                       |
| Base/worktree        | `5228cc84a29d98283800f90b39434825a407f51a`; dirty                               |
| Tracked diff SHA-256 | `f7487b03f34af3507d1b6795c6a634780b6ae0472f7919e11348affa2d87f331`              |
| Inventory SHA-256    | `958a931ba052d245e9dad8a084c4e1c58abfae67829ac42c6b629df054833d19`; stable=true |
| Cold                 | Fresh Bun process under `/usr/bin/time -l`; includes startup/dependency load    |
| Warm                 | One process, one unreported forced warmup, five reported forced compilations    |
| Memory               | Complete worker maximum RSS, not incremental engine memory                      |
| Cache/order          | Zero cache hits; filesystem caches not flushed; StyleX then Tailwind            |

### Exact Measurements

| Measurement                        |                                                             StyleX |                                                           Tailwind |
| ---------------------------------- | -----------------------------------------------------------------: | -----------------------------------------------------------------: |
| Artifact identity                  | `91ffd7ad4efbe238d7c93760c278ecb46fb33f4fb415d227f316c82736b0d45a` | `04624a90b81bc8bed1bf8555a478efedf5653a9ca5f568898c02300179739df7` |
| Artifact hash                      | `3546a6d1e1b6ef2e781277c472d80e63abbad941fc2443c76dcbde9cc17a2516` | `3d67c14e70e7ae096e1167de22d9e048ff0c6b0dfbd980dea29db922ffaae947` |
| Canonical archive identity         | `4dbab39b1fb78613cf891175b1d917a3ea7a17e63139f6f6c5a708809e2ab82a` | `b2b5350b444f9b420530cdc9676342d19c093eeb59035b84c11ac3915d12ce42` |
| Artifact compilation               |                                                    1,595.990833 ms |                                                      664.434792 ms |
| JavaScript raw/gzip                |                                                605,879 / 188,835 B |                                                597,595 / 185,327 B |
| CSS raw/gzip                       |                                                   11,402 / 4,241 B |                                                   44,586 / 9,853 B |
| Document                           |                                                              538 B |                                                              538 B |
| Fonts                              |                                                      9 / 205,324 B |                                                      9 / 205,324 B |
| Local assets                       |                                                          1 / 230 B |                                                          1 / 230 B |
| Full artifact                      |                                                          823,373 B |                                                          848,273 B |
| Canonical source archive           |                                                            2,260 B |                                                            4,571 B |
| Cold wall                          |                                                    1,868.790917 ms |                                                      851.554708 ms |
| Cold compilation                   |                                                    1,595.990833 ms |                                                      664.434792 ms |
| Cold peak RSS                      |                                                      660,897,792 B |                                                      385,089,536 B |
| Warm process wall including warmup |                                                    9,470.093083 ms |                                                    4,126.349583 ms |
| Warm forced 1                      |                                                    1,527.320625 ms |                                                      667.835000 ms |
| Warm forced 2                      |                                                    1,524.728209 ms |                                                      634.967166 ms |
| Warm forced 3                      |                                                    1,516.398458 ms |                                                      638.941583 ms |
| Warm forced 4                      |                                                    1,525.585750 ms |                                                      634.104750 ms |
| Warm forced 5                      |                                                    1,508.214708 ms |                                                      647.816458 ms |
| Warm median                        |                                                    1,524.728209 ms |                                                      638.941583 ms |
| Warm peak RSS                      |                                                      670,400,512 B |                                                      426,098,688 B |
| Repeated artifact/archive          |                                              Identical / identical |                                              Identical / identical |
| Distinct-cwd artifact/archive      |                                              Identical / identical |                                              Identical / identical |
| Archive reader                     |                                                               Pass |                                                               Pass |

### Measured Comparison

| Comparison               | Result                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Warm median              | StyleX 2.38633x Tailwind; +885.786626 ms                                                   |
| Cold wall                | StyleX 2.19456x Tailwind; +1,017.236209 ms                                                 |
| Whole-worker RSS         | StyleX +275,808,256 B cold; +244,301,824 B warm                                            |
| CSS                      | StyleX -33,184 B raw; -5,612 B gzip                                                        |
| JavaScript               | StyleX +8,284 B raw; +3,508 B gzip                                                         |
| Full artifact            | StyleX -24,900 B                                                                           |
| Canonical source archive | StyleX -2,311 B; authoring syntax differs, so this is not a general maintainability metric |

### Seven Direct Dependencies

| Dependency                        | Installed | Declared in                                          | Lock exact |
| --------------------------------- | --------- | ---------------------------------------------------- | ---------- |
| `@stylexjs/stylex`                | 0.19.0    | client-plugin compiler, client UI SDK, tracer plugin | Yes        |
| `@stylexjs/babel-plugin`          | 0.19.0    | client-plugin compiler                               | Yes        |
| `@stylexjs/unplugin`              | 0.19.0    | kernel client                                        | Yes        |
| `@babel/core`                     | 7.29.0    | client-plugin compiler                               | Yes        |
| `@babel/plugin-syntax-jsx`        | 7.28.6    | client-plugin compiler                               | Yes        |
| `@babel/plugin-syntax-typescript` | 7.28.6    | client-plugin compiler                               | Yes        |
| `@types/babel__core`              | 7.20.5    | client-plugin compiler                               | Yes        |

Transitive packages are not counted. Tailwind baseline additions are zero.

### Expanded Integration Accounting

| Area                           | Physical lines | UTF-8 bytes |
| ------------------------------ | -------------: | ----------: |
| Compiler                       |          1,096 |      37,230 |
| CLI activation                 |             29 |       1,069 |
| Backend activation/composition |            115 |       4,249 |
| Kernel Vite/route adapter      |             89 |       3,147 |
| Shared UI                      |            507 |      15,172 |
| Plugin                         |            195 |       5,161 |
| **Total**                      |      **2,031** |  **66,028** |

Tracer-only files use full content. Mixed existing files count additions against the base and can
include concurrent additions. Removed lines are excluded. Tests, generated routes, screenshots,
reports, and benchmark implementation are excluded. This is rough integration attribution, not a
maintainability score.

## Dependency And Integration Tradeoffs

- Kernel integration follows the upstream Vite adapter but must remain build-gated while Tailwind
  serves existing screens.
- Archive integration cannot use upstream Bun without weakening virtual-source/artifact boundaries;
  the bounded Babel adapter becomes maintenance if adopted.
- The seven direct dependencies are exact and used, but add update/security/toolchain surface.
- Expanded fingerprinting prevents stale trusted dependency reuse but hashes a broad dependency
  closure at process/module initialization.
- The latest fixture result has smaller CSS/full artifact but slower compilation and higher whole
  worker RSS. It cannot predict product scale.
- No fallback preserves correctness and diagnostics, but a StyleX failure blocks that build.
- The unresolved routing wrapper demonstrates that legacy-variable dependencies need explicit
  migration analysis rather than aliases.
- Repository persistence coverage uses production repository methods but no real PostgreSQL test
  layer; database-specific behavior remains unverified.

## Warnings, Gaps, And Unrun Checks

### Recorded Warnings

The final gated kernel production build passed with:

- Rolldown `INVALID_ANNOTATION` for Effect's misplaced `/*#__PURE__*/` comment.
- Vite warning that `index-C6X5sDZS.js` is 762.35 kB raw/247.06 kB gzip, above 500 kB.

The earlier six-month-old `caniuse-lite` warning was not present in the current final build log and is
not reported as current. Package lint logs report zero warnings/errors.

### Gaps And Unrun Checks

| Check                                    | Final status                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| Manual Vite HMR edit cycle               | Not run/proved                                                                 |
| Full repository unit suite               | Not run as one final aggregate; relevant scoped tests passed                   |
| Backend full check                       | Blocked only by two pre-existing `RequestInfo` errors; compiler check passes   |
| Full ordinary E2E suite                  | Not run; normal client-plugin browser regression passed                        |
| Firefox                                  | Not run                                                                        |
| Native Safari application/browser        | Not run; WebKit engine binary is the gate                                      |
| Native iOS                               | Not run                                                                        |
| Native Android                           | Not run                                                                        |
| Real PostgreSQL persistence layer        | Not run; repository methods use a recording database harness                   |
| Cloudflare WebKit final history re-entry | Two tunnel-only load timeouts after all tracer assertions; local WebKit passes |
| Hardware safe areas                      | Not run; detector-path browser evidence and direct-input unit evidence only    |
| Representative product migration         | Not run                                                                        |
| Filesystem-cold controlled benchmark     | Not run; filesystem cache/system load uncontrolled                             |
| Universal CSS type safety                | Not claimed or tested                                                          |
| Full CSS/StyleX feature matrix, SSR/RSC  | Outside tracer scope                                                           |

## Excluded And Unmodified Scope

No tracer changes were made under `apps/website`, `apps/browser-extension`, or `crates/frontend`.
Existing media/fitness UI, ordinary shared controls, shell/navigation, full palette, production data,
artifact/client API/bridge/compiler versions, ordinary import policy, and shipped plugin registration
remain unchanged in purpose. The kernel and ordinary plugins remain Tailwind-based when the flag is
off.

No StyleX compiler fork, dependency patch, alternate bundler migration, unsandboxed iframe,
handwritten bootstrap, public styling manifest field, compatibility alias for `--bg`, Tailwind
fallback, or legacy decoder was added.

## Retain/Delete Inventory

| Category                         | Inventory                                                                                                                                               | Disposition                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Candidate UI                     | Shared tracer controls/panel/tokens                                                                                                                     | Retain only for approved follow-up; generalize through a separate design |
| Candidate compiler method        | Official Babel transform/rule extraction and canonical logical identities                                                                               | Retain only while archived StyleX is investigated                        |
| Candidate requirements           | Original import preflight, limits-before-materialization, expanded fingerprint, positioned diagnostics, no fallback, persistent/restart/in-flight tests | Carry into any replacement/adoption design                               |
| Experimental fixture             | `plugins/stylex-tracer/**`, zip, screenshots                                                                                                            | Delete when evaluation closes                                            |
| Experimental kernel              | Route/gate/screen/scoped tests, Vite gate, generated route entry                                                                                        | Delete when evaluation closes                                            |
| Experimental activation/compiler | Environment services, CLI/backend exact-slug branches, protocol field, imports, adapter/declarations/tests                                              | Delete if rejected; redesign explicitly if adopted                       |
| Experimental verification        | E2E installer/suite/env gate and benchmark tree/results                                                                                                 | Delete after decision unless retained as follow-up regression evidence   |
