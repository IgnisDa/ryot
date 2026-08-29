# Sandbox SDK

Use `@ryot-app/sandbox-sdk/effect` for Effect and Schema in ordinary sandbox entrypoints. `defineScript`,
`defineOperation`, `defineProvider`, `defineAutomation`, and `defineAutomationPolicy` retain the
failure type returned by `run`. Declare expected plugin failures as typed values (for example,
tagged errors), and map external-library failures where they enter the script. The host methods
continue to fail with `SandboxHostError`; composing them into `run` includes that error in its
inferred failure union. No plugin-wide error schema is required.

`executeRyotqlRecipe` keeps host failures in their original channel and returns
`RyotqlRecipeDecodeError` for malformed recipe responses. `runSandboxTestScript` infers the
script's failure channel rather than erasing it in tests.

Workflows use the restricted Effect and Schema exports from `@ryot-app/sandbox-sdk/workflow`.
`defineWorkflow` accepts a typed failure channel for its body. Durable replay steps can fail with
schema or journal errors or signal a pending call. The workflow definition converts body failures
to a failed replay envelope; its host-facing `run` fails with `SandboxHostError` when the replay
journal cannot be read.

Shared plugin sources use the environment-neutral `@ryot-app/plugin-kit/effect` shim. It does not
export `Effect`; import the sandbox Effect surface in backend-only sources.
