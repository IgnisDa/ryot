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

`replay.sleep` may settle inline with host requests. The backend applies an inclusive 1,000 ms
per-wait limit and a shared 1,000 ms cumulative allowance per replay, including waits in `httpCall`
admission. Longer waits or waits without remaining allowance use durable replay. An inline sleep
returns raw `null`; host requests keep their typed success or failure results.

Shared plugin sources use the environment-neutral `@ryot-app/plugin-kit/effect` shim. It does not
export `Effect`; import the sandbox Effect surface in backend-only sources.

## Markdown Conversion

`@ryot-app/sandbox-sdk/markdown` exports the pure synchronous
`normalizeMarkdown(input: string, options?: { baseUrl?: string }): string`. It parses Markdown and
embedded HTML and returns restricted canonical Markdown without a final newline. It retains
paragraphs, strong and emphasized text, lists, blockquotes, hard breaks, HTTP/S links, and nested
inline `:spoiler[...]` and block `:::spoiler` directives. Relative links require `baseUrl`; unsafe or
invalid links become their label text. Directive attributes and unknown directive wrappers are
removed. Headings become strong paragraphs, tables become textual rows, code becomes literal text,
and images become alt text. Executable HTML, forms, and embedded media are removed. No raw HTML is
emitted. Normalizing canonical output again gives the same result.

`@ryot-app/sandbox-sdk/markdown-text` exports the dependency-free synchronous
`escapeMarkdownText(input: string): string` for literal input. It escapes punctuation and leading
whitespace, preserves blank-line paragraphs, and represents line breaks explicitly. This helper is
compiler-bundled; rich conversion uses the `markdown` runtime in the data and full snapshot tiers.
Both helpers require no host capabilities.

## Host Surface

Ordinary scripts use `ScriptHost`; before-stage policies use `PolicyHost`, which exposes only the
policy-safe methods. A helper type such as `Pick<ScriptHost, "httpCall">` narrows its TypeScript
surface but does not grant host access. `defineManifest` describes static identity, kind, and
kind-specific authored fields; capability metadata comes from the compiler, not the authored
manifest.

`sandboxHostContracts` in `src/core.ts` owns bridge argument and result schemas. The contract package
owns `SANDBOX_HOST_CAPABILITIES` and its policy-safe subset in
`@ryot-app/contract/modules/sandbox/wire`. Kernel `SANDBOX_CAPABILITY_REQUIREMENTS` and
`SANDBOX_HOST_EXECUTION_POLICY` (including its `dispatch` field) are exhaustive records; a bridge
operation change must keep both covered. SDK functions whose effects are not visible as direct host
calls are mapped by canonical module and export in `src/intrinsics.ts`; `readArtifact`,
`readArtifactRange`, and `readNamedArtifact` map to `artifact-read`. Compiler analysis checks the
declaring module identity, not an import alias.

## Boundary Errors

`SandboxHostError` and `SandboxFilesystemError` carry a readable `message` and optional structured
`data`. Stable boundary codes belong in `data`: `missing-required-config`, `missing-artifact-grant`,
`unavailable-operation`, `invalid-executable-target`, and `execution-limit`. Callers can branch on
those codes without replacing or parsing the message.
