# TypeScript Compiler

`@ryot-app/typescript-compiler` is private generic infrastructure shared by the client plugin and
plugin backend compilers. It owns TypeScript 7 native compiler resolution, virtual project
lifecycle, diagnostic collection, and normalized diagnostic output. The core entry stays free of
Rolldown so standalone plugin backend compiler workers can bundle the TypeScript project code.

The `./javascript-references` entry exposes a Rolldown AST visitor. It extracts static imports,
re-exports, literal dynamic imports, and `new URL(..., import.meta.url)` references from emitted
JavaScript. It reports nonliteral dynamic expressions to the caller; plugin client and backend compilers
enforce their own approval policies.

The Rolldown-free `./typescript-references` entry walks a parsed TypeScript source file and reports,
in document order, every import and export declaration with a module specifier, import assignment,
import type, dynamic import, and `import.meta` use, with `new URL(..., import.meta.url)` reported as
one site. Each reference carries its declaration or expression node, its literal specifier or `null`,
and whether its parent is the source file. Reference directives, glob interpretation, and every
approval decision stay with the plugin compilers.

Each target supplies a complete in-memory project configuration and resolved source/type aliases.
Dynamic compilation does not inherit repository or package TypeScript configuration.

`TypeScriptSession` owns one native TypeScript server for its Layer's lifetime, so the standard
library and dependency declarations are parsed once instead of per compile. `withTypeScriptProject`
checks each project in a fresh snapshot of that server: the session replaces the virtual project
files, reports the changed, created, and deleted paths, and disposes the previous snapshot only after
the next one exists, because the server reports changed files only against a live snapshot and the
client would otherwise keep serving stale syntax trees. A failed or interrupted server request
restarts the server on the next check. Compiler platform Layers provide the session, so workers,
local builds, and tests share it across compiles.

`TypeScriptSession.layer` checks only the project files: syntax, binding, and per-file semantics,
plus program and configuration diagnostics. Resolved dependencies are trusted.
`TypeScriptSession.environmentLayer` also checks global declarations and every resolved dependency;
it verifies a compiler environment, such as an image build, and is not used per job.

Projects normalize every diagnostic against the source file that reports it. Diagnostics in files
under the virtual root are `project` diagnostics with logical paths; diagnostics in resolved
dependencies, or without a file, are `environment` diagnostics because the compiler's own
dependencies failed rather than the submitted source. `typeScriptProjectErrors` reports environment
errors behind a caller-supplied diagnostic when any exist, and project errors otherwise.

The package does not own plugin import policies, compiler limits, worker protocols, output models, or
public compiler APIs. `@ryot-app/plugin-client-compiler` and `@ryot-app/plugin-backend-compiler` configure and
enforce those concerns independently.
