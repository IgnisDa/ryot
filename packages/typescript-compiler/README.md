# TypeScript Compiler

`@ryot-app/typescript-compiler` is private generic infrastructure shared by the client plugin and
backend sandbox compilers. It owns TypeScript 7 native compiler resolution, virtual project
lifecycle, diagnostic collection, and normalized diagnostic output. The core entry stays free of
Rolldown so standalone sandbox compiler workers can bundle the TypeScript project code.

The `./javascript-references` entry exposes a Rolldown AST visitor. It extracts static imports,
re-exports, literal dynamic imports, and `new URL(..., import.meta.url)` references from emitted
JavaScript. It reports nonliteral dynamic expressions to the caller; client and Deno compilers
enforce their own approval policies.

Each target supplies a complete in-memory project configuration and resolved source/type aliases.
Dynamic compilation does not inherit repository or package TypeScript configuration.

The package does not own plugin import policies, compiler limits, worker protocols, output models, or
public compiler APIs. `@ryot-app/client-plugin-compiler` and `@ryot-app/sandbox-compiler` configure and
enforce those concerns independently.
