# Kernel Client Guidelines

- Define application I/O and workflows as Effect service classes. Compose dependencies with layers and run them through the shared client `ManagedRuntime`.
- Keep routes as React adapters: resolve services, manage navigation and display state, and inject focused operations into presentational components.
- Decide route access in `beforeLoad` and load route data in `loader`. A redirect or a fetch that the route's identity depends on must never run from a component effect. Return resolved values from `beforeLoad` so components read them from route context instead of recomputing them, and present waiting, failure, and unresolved states with `pendingComponent`, `errorComponent`, and `notFound` rather than hand-rolled status state.
- Keep browser storage, transport, and third-party clients inside their live service layers.
- Test services with deterministic `Layer.succeed` implementations and plain recording functions. Do not use module mocks, spies, or mock functions.
