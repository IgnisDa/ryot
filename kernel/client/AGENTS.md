# Kernel Client Guidelines

- Define application I/O and workflows as Effect service classes. Compose dependencies with layers and run them through the shared client `ManagedRuntime`.
- Keep routes as React adapters: resolve services, manage navigation and display state, and inject focused operations into presentational components.
- Keep browser storage, transport, and third-party clients inside their live service layers.
- Test services with deterministic `Layer.succeed` implementations and plain recording functions. Do not use module mocks, spies, or mock functions.
