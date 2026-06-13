# Kernel Client Guidelines

- Define application I/O and workflows as Effect service classes. Compose dependencies with layers and run them through the shared client `ManagedRuntime`.
- Keep routes as React adapters: resolve services, manage navigation and display state, and inject focused operations into presentational components.
- Decide route access in `beforeLoad` and load route data in `loader`. A redirect or a fetch that the route's identity depends on must never run from a component effect. Return resolved values from `beforeLoad` so components read them from route context instead of recomputing them, and present waiting, failure, and unresolved states with `pendingComponent`, `errorComponent`, and `notFound` rather than hand-rolled status state.
- Keep browser storage, transport, and third-party clients inside their live service layers.
- Expose semantic application data and capabilities through the environment-neutral `@ryot/client-sdk` surface so kernel and plugin call sites use the same API. Back kernel calls with direct adapters and plugin calls with the per-session `MessageChannel` adapter; transport differences must not leak into application code.
- Keep kernel-owned concerns such as authentication, server selection, browser history ownership, artifact lifecycle, and bridge dispatch in kernel services. Do not expose them to plugins only to make the implementations look identical.
- Test services with deterministic `Layer.succeed` implementations and plain recording functions. Do not use module mocks, spies, or mock functions.
