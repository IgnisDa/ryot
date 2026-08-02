# TypeScript Compiler

`@ryot-app/typescript-compiler` is private generic infrastructure shared by the client plugin and
backend sandbox compilers. It owns TypeScript 7 native compiler resolution, virtual project
lifecycle, diagnostic collection, and normalized diagnostic output.

Each target supplies a complete in-memory project configuration and resolved source/type aliases.
Dynamic compilation does not inherit repository or package TypeScript configuration.

The package does not own plugin import policies, compiler limits, worker protocols, output models, or
public compiler APIs. `@ryot-app/client-plugin-compiler` and `@ryot-app/sandbox-compiler` configure and
enforce those concerns independently.
