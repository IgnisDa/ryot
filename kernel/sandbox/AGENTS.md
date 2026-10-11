# Sandbox Guidelines

- Never import `@ryot-app/kernel-backend`. Product behavior reaches the host only through the ports listed in `README.md`; isolation, resource limits, protocol validity, and containment checks stay here. Execution principals and capability eligibility belong to the backend's `modules/scripts/authorization`.
- `package.json` `exports` lists each file consumed outside the sandbox explicitly; add an entry only for a real external consumer and never a wildcard or barrel.
- Every global and op reachable from an isolate is explicit. A new op must be added to
  `native/ops.inventory`; remove globals that reach unmetered native memory rather than reimplementing them.
- After any `deno_core` or V8 upgrade, rerun the termination, escape, crash, and Linux launcher suites,
  including the `sandbox-test` image steps in `.github/workflows/sandboxd.yml`
  (`docker buildx build --target sandbox-test`, then `docker run --user 0` for the launcher tests).
- Sandbox code, protocol, and fixtures stay product-agnostic: no first-party plugin, provider, or domain names.
