# Sandbox Sidecar Guidelines

- Every global and op reachable from an isolate is explicit. A new op must be added to
  `ops.inventory`; remove globals that reach unmetered native memory rather than reimplementing them.
- After any `deno_core` or V8 upgrade, rerun the termination, escape, crash, and Linux launcher suites,
  including the `sandbox-test` image steps in `.github/workflows/sandboxd.yml`
  (`docker buildx build --target sandbox-test`, then `docker run --user 0` for the launcher tests).
