# Server assembly

The server composes kernel features and shipped plugin artifacts. Plugin installation uses compiled
archives; user-authored pages and agent scripts compile on demand through their feature-owned
compiler services.

The production build emits client and backend compiler worker entry points beside the server bundle.
Only the worker implementations stay external, so each process loads a single copy of Effect and the
shared protocol schemas. Both compiler packages remain runtime dependencies, supplying their worker
implementations and SDK resolution. Workers type-check SDK sources from the image's production
install, so packages in that source closure declare the `@types/*` packages their source needs as
dependencies. `tooling/smoke-compiler-workers.ts` validates the built client page artifact graph and
compiles an agent SDK script through the backend worker, checking capability metadata and workspace
cleanup. The Docker image runs both checks before startup.
