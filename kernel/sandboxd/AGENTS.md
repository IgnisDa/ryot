# Sandbox Sidecar Guidelines

- Every global and op reachable from an isolate is explicit. A new op must be added to
  `ops.inventory`; remove globals that reach unmetered native memory rather than reimplementing them.
- Keep `--no-turbofan` until [denoland/rusty_v8#2088](https://github.com/denoland/rusty_v8/issues/2088)
  is fixed upstream and the termination tests pass without it.
- After any `deno_core` or V8 upgrade, rerun the termination, escape, crash, and Linux launcher suites,
  including `tests/launcher/test-default-docker.sh`.
