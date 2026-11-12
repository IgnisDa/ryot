# Server assembly

The server composes kernel features and shipped plugin artifacts. Plugin installation uses compiled
archives; user-authored pages and agent scripts compile on demand through their feature-owned
compiler services.

The production build emits client and backend compiler worker entry points beside the server bundle.
Both compiler packages remain runtime dependencies, supplying their worker implementations and SDK
resolution. `tooling/smoke-compiler-workers.ts` validates the built client page artifact graph and
compiles an agent SDK script through the backend worker, checking capability metadata and workspace
cleanup. The Docker image runs both checks before startup.
