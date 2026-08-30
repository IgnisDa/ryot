# Vite Compiler

`@ryot-app/vite-compiler` is private, concrete infrastructure shared by Ryot's compiler workers. It
owns scoped `source/`, `generated/`, and `output/` filesystem workspaces, sanitized worker
environments, protected programmatic Vite 8 invocation, normalized diagnostics, deterministic
in-memory collection of every emitted file, and Ryot's shared Deno ESM build profile.

Every build receives its target compiler's self-contained TypeScript project options. Vite and
Rolldown use the runtime-relevant transform options without discovering `tsconfig.json` files from
resolved package sources; normal Vite filesystem and package resolution remains enabled.

Workspace acquisition and staging are typed Effect APIs. `acquireCompilerWorkspace` uses the
standard Effect `FileSystem` service and `Effect.acquireRelease`; its workspace is removed when the
owning scope closes. A caller can supply `parentPath` and `jobId` so its supervisor knows the job
directory before worker startup. `ViteBuildService.layer` provides the live Vite invocation and can
be replaced by a deterministic Layer in tests. Public failures use `ViteCompilerError` and its stable
`reason` field. Pure path validation, environment sanitization, and output collection return Effect
`Result` values; they do not throw. Bun callers provide the standard `BunFileSystem.layer` (or their
existing Bun services Layer) to workspace Effects.

`buildDenoEsm` emits exactly one unminified ES2022 ESM file with an inline source map. It accepts
either staged source files and a relative entry or an external/absolute entry through a generated
re-export. Callers provide exact aliases, the output filename, and the approved external import set.
The facility disables CSS, module preload, and code splitting, preserves strict entry signatures,
normalizes source-map paths, and rejects Node, Bun, URL, npm, and jsr imports, unapproved externals,
CommonJS output, and browser-only Vite helpers. It infers its TypeScript transform configuration and
does not discover tsconfig files.

The package does not own plugin source, TypeScript analysis,
artifact limits, hashing, publication, worker supervision, or client and Deno artifact contracts.
Those decisions remain with the target compiler and its parent supervisor. The package does not
load caller Vite, environment, public-directory, or PostCSS configuration and does not install or
execute dependencies from staged sources.
