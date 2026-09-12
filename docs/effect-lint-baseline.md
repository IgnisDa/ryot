# Effect lint baseline

The `@effect/tsgo` recommended preset is the policy for active Bun workspaces. The root
`.oxlintrc.json` explicitly sets severities for Effect rules that Oxlint's global categories
would otherwise enable implicitly: `any-unknown-in-error-context` is an error outside migration
areas, and `strict-effect-provide` remains a warning. The tool versions are pinned in the root
`package.json`; review effective Effect severities when upgrading them. Oxlint owns CI diagnostics.

The scoped overrides in `.oxlintrc.json` temporarily lower existing errors to **warnings**;
they do not turn off the rules. New code outside those scopes keeps the root severity. Do not
widen an override to cover a new error. Remove rules as their affected code migrates, then
remove empty overrides. All currently enabled Effect rules remain part of the target policy.

| Migration work                                   | Warning scopes to retire                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend database sessions and service boundaries | `kernel/backend/src/**` and the sandbox-runtime-inputs test: typed Effect errors.                                                                                                       |
| Client and plugin boundary                       | `kernel/client/src/**`, `packages/client-sdk/src/**`, `packages/client-ui-sdk/src/**`, and `packages/kernel-renderers/src/**`: asynchronous APIs, errors, JSON, and browser operations. |
| Plugin authoring and SDK                         | `packages/sandbox-sdk/{src,tests}/**` and `plugins/{media,fitness,fixture}/**`: typed errors, Effect operations, and existing client/test Promise code.                                 |
| Remaining workspace sweep                        | `apps/{website,browser-extension}/**` and `packages/{cli,client-plugin-compiler,plugin-archive,testing,vite-compiler}/**`: framework/build boundaries and their tests.                  |
| Build tooling cleanup                            | `kernel/client/scripts/generate-assets.ts` and `packages/kernel-renderers/scripts/generate-sources.ts`.                                                                                 |

These entries describe ownership, not blanket lint exemptions: the config lists the affected
files/directories and rules. E2E has a separate lint policy; review its existing Promise
exceptions during the E2E migration. For a read-only lint pass, run `oxlint . --type-aware`
in the affected workspace.

Run `bun turbo --output-logs=full check` after changing the policy. Workspace `check` tasks run
`oxfmt --write` and `oxlint --fix`, so inspect the resulting diff. Run
`bun turbo --filter='!@ryot-app/e2e' --output-logs=full test` for workspace tests.
