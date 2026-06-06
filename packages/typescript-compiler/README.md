# TypeScript Compiler

`@ryot/typescript-compiler` is private generic infrastructure shared by the client plugin and
backend sandbox compilers. It owns TypeScript 7 native compiler resolution, virtual project
lifecycle, diagnostic collection, and normalized diagnostic output.

The package does not own plugin import policies, compiler limits, worker protocols, output models, or
public compiler APIs. `@ryot/client-plugin-compiler` and `@ryot/sandbox-compiler` configure and
enforce those concerns independently.
