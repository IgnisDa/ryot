# Client Plugin Contract

`@ryot-app/client-plugin-contract` owns the environment-neutral boundary shared by client plugins,
the client kernel, the client plugin compiler, archive tooling, and artifact persistence. This
includes the iframe bridge protocol, client artifact format, client source file policy, and the
wire-safe capability payloads used by the direct and bridge-backed client adapters.

The package builds these specialized contracts from generic HTTP-contract schemas such as entity
identifiers, JSON values, RyotQL documents, and managed asset locators. `@ryot-app/contract` must not
depend on this package.
