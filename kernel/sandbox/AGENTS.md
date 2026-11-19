# Sandbox

- Never import `@ryot-app/kernel-backend`. Backend ports supply authority and product behavior; this package owns isolation and containment.
- Declare every isolate-reachable global and op explicitly; add new ops to `native/ops.inventory`. Remove globals exposing unmetered native memory.
- Keep explicit per-file package exports, with no wildcard or barrel.
- After `deno_core` or V8 upgrades, run termination, escape, crash, and Linux launcher suites, including the `sandbox-test` image steps documented in `.github/workflows/sandboxd.yml`.
