# Ryot: hard cutover to Vite

## 1. Objective and fixed decisions

Replace Bun’s bundler throughout the **plugin compilation and Deno execution-artifact pipeline** with Vite. Use the refactor to remove custom module-resolution, stylesheet, and asset-processing machinery—not merely translate the existing implementation into Vite hooks.

Use one pinned Vite 8 version and its Rolldown-backed build pipeline. Do not introduce esbuild, invoke Rolldown separately, or create an interchangeable bundler abstraction. Vite 8 provides the consolidated Rolldown-based pipeline this plan targets. ([vitejs][1])

The fixed decisions are:

- **Bun remains the host runtime and package manager. Deno remains the sandbox execution runtime.**
- **Client applications and Deno modules use separate Vite build profiles**, sharing concrete build infrastructure where useful.
- **Compilation uses compiler-owned filesystem workspaces**, not an in-memory source map requiring custom resolution for every import.
- **Multiple client stylesheets are supported.** Vite owns their compilation, dependency ordering, and asset handling.
- **This is a replacement, not a migration framework.** No alternate compiler path, compatibility adapter, stale-artifact fallback, or dependency-specific bundler repair remains.

The scope includes:

| Build surface                                | Primary existing location                                               |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Client plugins and saved-view pages          | `packages/client-plugin-compiler`                                       |
| Backend plugins, built-ins, and user scripts | `packages/sandbox-compiler`                                             |
| Trusted Deno dependency bundles              | `kernel/backend/src/lib/infrastructure/sandbox-runtime/dependencies.ts` |
| Trusted Deno runner                          | `kernel/backend/scripts/compile-sandbox-runner.ts`                      |

The client and sandbox compilers already use Bun independently; the latter deliberately preserves specific runtime imports. Their target-specific semantics should remain separate after the replacement.

Do not expand this into a migration of the kernel’s execution runtime, an unrelated application-build rewrite, or a new plugin HMR system. Build changes needed to package and run the compiler workers are in scope.

## 2. Establish the contracts before replacing implementations

Start by recording the current behavior and running the relevant existing tests. Preserve useful behavioral tests; do not preserve tests solely because they encode Bun’s emitted text.

Document the compiler entrypoints and their callers, including plugin installation, built-in compilation, standalone user scripts, saved-view pages, startup preparation, and production worker packaging.

### Deno execution contract

Treat the current Deno execution model as a requirement, not something to redesign around Vite.

The existing flags disable configuration discovery, npm resolution, remote module loading, environment access, subprocesses, and FFI. Networking is scoped to the local host-bridge port. Filesystem access is scoped, with optional artifact reads and execution-specific scratch-directory writes. **Do not simplify this into either unrestricted Deno or a blanket denial that breaks existing grants.**

Preserve:

**Module loading.** Compiled plugin modules load as local ESM. Approved runtime imports resolve through the compiler-owned local import map. No package downloads or remote module resolution occur during execution.

**Artifact integrity.** Backend JavaScript remains content-addressed and verified before use. Preserve immutable publication, execution-specific module acquisition, and safe interaction with garbage collection. The current implementation explicitly verifies the JavaScript hash and materializes a single `.mjs` file.

**Runtime behavior.** Preserve runner initialization and hardening order, host-call mediation, execution limits, and workflow determinism. Do not bundle untrusted plugin code into the trusted runner or evaluate it during compilation.

The existing Deno host bridge and browser iframe bridge remain. They are runtime security and communication mechanisms, not migration compatibility code.

### Baseline measurements

Record cold and repeated compilation duration, peak compiler-process-tree memory, artifact sizes, and Deno startup/execution behavior for representative fixtures and the media and fitness plugins.

The Dockerfile currently contains an explicit warning about an Effect-related build failure. Verify and record that baseline separately; do not misclassify it as a Vite regression or silently claim the final container passes without running it.

**Deliverable:** a short contract/baseline document and behavioral fixtures that can validate the replacement.

## 3. Build the shared filesystem and Vite infrastructure

Introduce one small shared build-infrastructure package. Keep it concrete: workspace management, Vite invocation, diagnostic normalization, and output collection.

Leave client policy and artifact orchestration in the client compiler. Leave sandbox policy, manifest extraction, and workflow validation in the sandbox compiler. Retain `packages/typescript-compiler` as the TypeScript integration rather than creating another type-checking implementation; its documented responsibility is already generic compiler infrastructure.

The intended flow is:

```text
Validate input
    → Stage compiler-owned workspace
    → Validate source policy and types
    → Build with the appropriate Vite profile
    → Validate emitted output
    → Package and hash
    → Publish
```

### Filesystem workspace

Give each compilation job a private workspace containing validated source files, compiler-owned entry files and configuration, and controlled access to the installed trusted dependencies.

Preserve archive-relative source paths. Place generated bootstrap files outside the untrusted source namespace so uploaded files cannot replace them.

Reject path traversal, unsupported file types, archive-supplied symlinks, and collisions with compiler-owned files before writing sources. Do not install dependencies or execute package scripts from plugin archives.

Let normal package exports and filesystem resolution handle supported imports. Do not reproduce the current extension/index-file candidate search in a new custom resolver. Align the TypeScript project with the staged filesystem and intended package-resolution conditions.

Test supported extensionless imports, `.js` references to TypeScript sources where currently permitted, package exports, shared sources, and type-only imports.

### Policy enforcement remains explicit

Filesystem staging does **not** grant plugins access to everything the build process can read.

Validate author-written imports before transformation, including type-only imports that bundling would erase. Preserve the distinction between permitted imports from plugin sources and trusted dependencies’ own transitive imports.

After resolution, enforce real-path containment and target-specific boundaries. Client sources may not reach backend sources; shared sources retain their environment-neutral policy.

Cover more than JavaScript imports. CSS imports, asset URLs, Tailwind source declarations, and special Vite import features must not become alternate ways to read arbitrary host files.

In particular, reject plugin-controlled build-time code loading such as Tailwind `@plugin` and `@config`. Make source-scanning declarations compiler-owned. Validate dangerous directives before the relevant build plugin can act on them.

These checks should decide whether an operation is permitted. **They should not perform their own CSS compilation, asset copying, or output rewriting.**

### Compiler-owned Vite configuration

Invoke Vite programmatically with configuration discovery disabled. Use its supported build API rather than running a Vite CLI against an uploaded project. ([vitejs][2])

Set compiler-owned defaults including:

```ts
{
  configFile: false,
  envDir: false,
  publicDir: false,
  clearScreen: false,
  css: {
    postcss: { plugins: [] },
  },
}
```

Vite supports disabling environment-file loading and public-directory copying; inline PostCSS configuration prevents discovery of another PostCSS configuration. Also provide a sanitized worker environment: disabling `.env` loading alone does not prevent exposure of inherited environment variables. ([vitejs][3])

Do not load archive-supplied Vite, PostCSS, Tailwind, or TypeScript configuration. Do not merge host environment variables into `define`.

Route build logs through structured diagnostics or bounded stderr. Vite output must not corrupt the worker’s stdout protocol. Preserve actionable source locations and warnings; do not globally suppress warnings to make builds appear clean.

### Worker lifecycle and cleanup

Continue compiling inside supervised workers, not inside the kernel’s main process. Preserve concurrency, timeout, memory, and output limits. The current supervisor already measures process-tree memory and can kill a worker with `SIGKILL`.

Make workspace ownership visible to the parent supervisor. Cleanup must work after success, compilation failure, cancellation, timeout, memory exhaustion, and forced worker termination. Do not depend solely on worker finalizers.

For direct compiler calls in tests or tooling, use the same workspace lifecycle with an explicit scoped owner. Keep all writable build caches inside controlled job or toolchain locations.

**Deliverable:** shared infrastructure with resolution-policy, environment-isolation, diagnostics, and forced-termination cleanup tests.

## 4. Migrate the trusted Deno runtime first

Prove Vite’s Deno output before migrating the larger frontend compiler.

### Create a Deno ESM profile

Use an explicit ESM library/module build—not default Node-oriented SSR behavior.

Configure a JavaScript syntax target verified against the repository-pinned Deno version. Configure dependency resolution for the intended Deno/Web-compatible entrypoints, rather than blindly accepting Node defaults or assuming browser resolution is always correct.

Keep backend output unminified initially. Preserve useful source maps where currently provided, with stable source paths rather than random staging-directory paths.

The output audit must reject unexpected runtime dependencies: Node built-ins, Bun imports, unresolved CommonJS loading, remote module specifiers, and browser-only runtime helpers. Do not accept an empty browser stub as a successful resolution of an unsupported dependency.

Use ordinary supported configuration and dependency entrypoints. No emitted-JavaScript regex patching, broad Node polyfills, or vendored bundler repairs.

### Make runtime dependency declarations authoritative

Replace the current positional dependency associations, duplicated external lists, and hand-maintained version labels with one data-only runtime registry.

Derive from it the approved external specifiers, trusted entry files, import-map aliases, emitted filenames, and runtime metadata. Derive dependency versions from the resolved toolchain rather than independent string constants.

The current runtime maps both the sandbox SDK and neutral plugin-kit aliases onto common Effect and RyotQL files. Preserve that module identity; independently bundling copies into plugins would change the runtime contract.

Distinguish two kinds of existing code:

**Bundler repair:** remove it.

**Intentional runtime API adaptation:** preserve its behavior, but express it as ordinary typed source modules rather than opaque generated JavaScript strings where practical.

This distinction matters for the supported Effect surface and packages such as YouTubei. Do not delete a real runtime adaptation merely because the current implementation is awkward.

### Build and ship the trusted runtime payload

Move trusted dependency bundling into an explicit build/preparation task alongside runner generation. Ship the generated dependency modules, import map, and integrity metadata with the application.

At startup, verify and materialize that payload. Startup should not rediscover packages and rebundle the trusted SDK. Dynamic compilation of uploaded plugin sources remains a runtime operation.

Retain content-addressed publication and corruption detection. Missing or inconsistent payloads must fail clearly; there is no fallback to the old generator.

Update development tasks so changes to the runner, SDK dependencies, import registry, or relevant configuration regenerate the trusted payload before it is used. Do not introduce a separately maintained development-only compiler.

### Migrate the runner

Replace its Bun build with the same Deno profile and explicit runner externals. Preserve its initialization order and its separation from plugin evaluation.

Keep kernel-script source embedding as a distinct concern even if the same preparation command orchestrates both tasks. The existing runner-build script also performs that embedding, so replacing the bundling call must not accidentally remove it.

**Required gate:** execute the generated runner and dependency payload through the actual Deno launcher and its existing permissions. Exercise every approved SDK family with deterministic fixtures, including alias interoperability and a mediated host call. A build that merely emits valid-looking ESM does not pass.

## 5. Migrate the sandbox compiler

Replace the bundling stage for standalone user scripts, built-in scripts, and plugin backend entrypoints with the shared Vite Deno profile.

### Preserve one module per backend entry

Emit exactly one executable ESM module for each backend entry, plus the already-supported inline source-map representation.

Bundle local sources and designated SDK implementation modules. Leave only the exact approved runtime imports external.

Do not introduce shared chunks between backend entries. That would unnecessarily change the current single-module storage, acquisition, and execution model. Compile entries independently with bounded concurrency; reuse TypeScript analysis within a package where appropriate.

Validate emitted imports against the runtime registry. Unknown externals must fail compilation instead of surviving until Deno execution.

### Preserve semantic compilation

Retain TypeScript diagnostics, static manifest extraction, definition/declaration consistency checks, import policies, source and output limits, and workflow determinism validation. The existing compiler performs these independently of bundling; Vite must not replace them with module evaluation.

Use the TypeScript project’s resolved source relationships for reachable workflow analysis where possible, rather than maintaining another relative-import resolver.

Keep diagnostics associated with original plugin paths. Verify that generated source maps remain stable when the same source is compiled in different temporary directories.

Update every sandbox compiler caller. Do not leave standalone user scripts or built-ins on the old path while plugin packages use Vite.

**Deliverable:** all backend source categories compile with Vite and execute through the unchanged Deno execution contract.

## 6. Replace the client build pipeline

Use a **normal Vite application build** with a compiler-owned HTML entry and bootstrap.

Do not use client library mode: Vite’s library mode has different asset-inlining behavior, whereas these artifacts need to behave as complete iframe applications with separately emitted assets. ([vitejs][4])

### Bootstrap and JavaScript

Preserve ordinary plugin bootstrapping and the saved-view page bootstrap as explicit variants. Generate their entry files in the compiler-owned namespace.

Use a relative deployment base, production React behavior, and an explicit browser target. Verify that target against both the supported browser application and the existing mobile WebView requirements.

Resolve approved SDK packages through their public exports. Delete the Lucide distribution-path override, TanStack package repairs, and synthetic client Effect replacement rather than carrying them into Vite plugins. Those repairs are explicitly present in the current bundler integration.

Do not broaden the plugin authoring API simply because Vite supports more features. Preserve existing restrictions on module loading and unsupported import forms.

### CSS, Tailwind, fonts, and assets

Use the official `@tailwindcss/vite` integration. Express common base styles, fonts, theme, and palette as ordinary compiler-owned stylesheet sources and imports. Let Vite handle asset emission and URL rewriting. ([Tailwind CSS][5])

The compiler owns the Tailwind entry. Remove redundant Tailwind root imports from built-in plugin sources during the cutover rather than preserving duplicate-entry compatibility behavior.

Configure explicit Tailwind source registration for the plugin and required UI SDK sources. Disable implicit repository-wide scanning. Tailwind supports disabling automatic detection and registering source locations explicitly. ([Tailwind CSS][6])

Support multiple CSS files imported from different client modules, including nested relative CSS imports. There must be no “at most one imported stylesheet” validation.

Preserve the intended cascade, token behavior, dark mode, accessibility rules, and fonts through behavioral tests. Do not alphabetically sort stylesheets as a substitute for dependency order. Tests must also cover a plugin with no authored stylesheet.

Delete manual Fontsource parsing, custom asset-name substitution, CSS-to-empty-JavaScript interception, and the parallel stylesheet dependency graph. The current client implementation contains all of these responsibilities.

Retain only policy validation that is necessary to constrain what these standard build stages may access.

### Consume emitted artifacts directly

Collect Vite’s emitted HTML, JavaScript, CSS, and assets through the build result.

Do not rewrite emitted JavaScript to force the old filenames or reconstruct the old asset graph. Configure naming through supported build options and update the artifact contract where necessary.

Validate every emitted relative path and content type. Bound file count and total artifact size. Reject paths or references that escape the artifact.

Let the frontend artifact represent the complete emitted file set. Preserve existing authoring restrictions independently of whether Vite internally emits one or several files.

**Required gate:** load the artifact through Ryot’s actual iframe serving and bootstrap path—not only a development server or a JavaScript evaluation test.

## 7. Integrate artifact identity, consumers, and production packaging

### Invalidation and publication

Introduce a compilation identity that accounts for the relevant compiler version, target configuration, policy, SDK/toolchain inputs, and client style inputs.

Keep compilation identity distinct from the output content hash. Unchanged plugin source must not cause reuse of output built against an obsolete compiler or SDK.

Update artifact schemas and cache checks directly. Regenerate compiler-derived artifacts from their sources. Do not retain an old-format reader or Bun fallback.

Publish only after the complete target build and validation succeed. A failed client or backend compilation must not publish a partially usable installation.

Preserve a documented, non-circular artifact-hashing scheme. The current client HTML embeds metadata derived from the other artifact files; account explicitly for generated HTML/template changes rather than accidentally hashing an artifact’s hash into itself.

### Update consumers

Audit consumers for assumptions about `plugin.js`, `plugin.css`, flat asset names, one stylesheet, or old compiler metadata.

Update artifact storage, serving, client sessions, installation, saved-page publishing, built-in loading, and development tooling to use the new artifact representation consistently.

Keep URL resolution inside the artifact’s existing authorization boundary. Relative assets must work from the actual served document location without exposing arbitrary filesystem paths.

No global database reset is required. Any development cleanup should target compiler-derived state explicitly, not unrelated application data.

### Ship the actual runtime toolchain

Vite, its required native components, Tailwind’s integration, TypeScript infrastructure, and the trusted SDK/type-resolution inputs needed for dynamic compilation must survive production dependency pruning.

The Dockerfile currently has a dedicated production compiler-dependency installation stage and runs packaged-worker smoke tests. Update those paths rather than validating only against a developer checkout.

Test the packaged workers under Bun with the actual pruned dependency layout. Test the trusted payload under the pinned Deno runtime. Cover the supported Linux architectures.

Do not add an automatic Node-host fallback if a Vite/Bun integration problem appears. Resolve the concrete problem or report it as an implementation blocker; do not conceal it behind another execution path.

## 8. Delete the old implementation and enforce acceptance gates

After all callers use Vite, remove the superseded Bun plugin resolvers, virtual source-loading machinery, manual CSS/asset build pipeline, and dependency-specific repairs.

Remove minified-binding regex assertions. Replace them with behavioral tests for the original failure cases: Lucide rendering, Effect namespace usage, TanStack hooks, SDK-only Tailwind classes, and loadable iframe artifacts.

Remove obsolete direct dependencies only after checking their remaining legitimate uses. A parser retained for source-policy validation is not automatically obsolete merely because CSS rewriting disappeared.

Update compiler READMEs, package-local `AGENTS.md` files, runtime documentation, development commands, and build-task dependencies.

### Acceptance matrix

| Area                  | Required evidence                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deno execution        | Generated runner, runtime dependencies, built-ins, plugin entries, and user scripts execute under the existing launcher and grants.                             |
| Runtime identity      | Approved aliases resolve consistently; cross-SDK Effect/RyotQL usage works without duplicate runtime implementations.                                           |
| Browser execution     | Real iframe tests cover ordinary plugins and saved pages, bootstrap exactly once, icons, hooks, forms, fonts, themes, and asset loading.                        |
| Styles                | Multiple imported stylesheets, nested imports, SDK-only classes, and no-authored-stylesheet cases work with correct cascade behavior.                           |
| Source policy         | JavaScript, type-only imports, CSS, assets, Tailwind directives, and special import forms cannot bypass source boundaries or trigger untrusted build-time code. |
| Environment isolation | Host `.env` files and inherited secret variables do not appear in output or influence plugin builds.                                                            |
| Determinism           | Identical inputs in different job directories produce identical artifact identities and output bytes; relevant toolchain/input changes invalidate reuse.        |
| Failure handling      | Errors, timeout, cancellation, memory exhaustion, and forced termination publish no partial artifacts and leave no job-owned workspace behind.                  |
| Production packaging  | Pruned, packaged workers compile successfully; the shipped runtime payload executes without npm or remote module loading.                                       |
| Performance           | Cold/repeated build time, peak process-tree memory, and artifact size are measured against the baseline; material regressions are explained.                    |

### Implementation order and completion report

Implement the shared workspace and policy infrastructure first. Then complete the trusted Deno payload and runner gate. After that, the sandbox compiler and client compiler work can proceed independently against the shared infrastructure. Finish with consumer integration, production packaging, deletion, and full regression testing.

The implementation report must identify the new architecture, removed workarounds, changed artifact contracts, exact verification commands and results, performance measurements, and any unresolved failures. Separate pre-existing failures from cutover regressions.

**Completion means one Vite-based compilation path, normal filesystem/package resolution, standard frontend CSS and asset processing, and verified execution inside Ryot’s actual Deno and iframe environments—not merely successful calls to `vite.build()`.**

[1]: https://vite.dev/blog/announcing-vite8 "Vite 8.0 is out! | Vite"
[2]: https://vite.dev/guide/api-javascript "JavaScript API | Vite"
[3]: https://vite.dev/config/shared-options "Shared Options | Vite"
[4]: https://vite.dev/config/build-options "Build Options | Vite"
[5]: https://tailwindcss.com/docs/installation/using-vite "Installing Tailwind CSS with Vite - Tailwind CSS"
[6]: https://tailwindcss.com/docs/detecting-classes-in-source-files "Detecting classes in source files - Core concepts - Tailwind CSS"
