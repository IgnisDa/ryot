# App Client Guidelines

Ryot is a self-hosted personal tracker. Keep the UI warm, calm, compact, scannable, WCAG AA compliant, and free of generic SaaS/social-feed aesthetics or novelty motion.

- Use `clsx` for conditional/dynamic `className`. Never template strings or bare ternaries.
- Prefer Tailwind responsive variants (`sm:`, `md:`, `lg:`) and CSS utilities over JS layout (`useWindowDimensions`, `onLayout`, manual pixel math). Fall back to JS only when layout depends on runtime data.
- Prefer `className` for static layout, spacing, sizing, opacity, borders, and colors. Use inline `style` only for dynamic runtime values, safe-area insets, animation output, or native-only props that Tailwind cannot express.
- Use a single `props` parameter, not destructured arguments.
- Use `@tanstack/react-hotkeys` for web keyboard shortcuts. Do not register document keyboard listeners manually.
- Use `AppModal` from `src/modules/ui/modal.tsx` for true modal dialogs so backdrop, native back, accessibility, and web Escape behavior stay consistent.
- Construct contract clients and HTTP layers only under `src/api`; feature modules must use the shared clients and query wrappers.
- Authenticated feature operations must accept `ApiScope`, not raw server URLs. Public onboarding and admin flows are the only exceptions.
- Do not create parallel authenticated API clients or feature-owned transport wrappers; extend the scoped client under `src/api`.
- Key authenticated query state and invalidation by normalized server URL and user ID. Never create authenticated query atoms before both values are available.
- Never place credentials, cookies, tokens, or other secrets in atom keys, cache keys, reactivity keys, or persisted identifiers. Use opaque session identifiers.
- Key admin state by `AdminSession` and keep admin tokens in the `src/api` session registry, never in a feature module, an atom, or persistence.
- Shared section navigation, search, pagination, and row-menu primitives live in `src/modules/ui`. Features contribute section data and screens, not their own sidebar or table chrome.
- Centralize app-state and network-reconnect listeners. Features must consume the shared revalidation signal instead of registering duplicate listeners.
- Define parameterized query and mutation atoms with module-level `Atom.family` and canonical immutable keys; exported atom factories must not construct atoms per call or use mutable request registries.
- Keep request documents, response decoding, typed application states, and atoms in the feature that owns them. Routes may handle route and session prerequisites, but must not decode generic backend responses.
- Shared presentation primitives belong under `src/modules/ui`; features must not import generic UI components from another feature module.
- Build plugin-catalog flows (import sources, integration providers) on `src/modules/ui/plugin-catalog`, `src/modules/ui/wizard`, and `src/modules/ui/search-param-modal`. A feature owns only its domain type, its `CatalogEntry` mapping, its copy, and its request payload.
- Map request failures to user-facing copy through `src/api/request-failure.ts`. Do not hand-write the transport-error/malformed branch or re-extract `BadRequest` messages in a feature.
- Use `@tanstack/react-form` for submitted data-entry forms and the shared controls under `src/modules/ui/form.tsx`; keep search inputs, workflow state, domain validation, and payload construction with their existing owners.
- Keep editable values single-owned by TanStack Form. Do not mirror form values, errors, dirty state, or submission state in React state or atoms; external state is only for workflows and authoritative server snapshots.
- Resolve Effect dependencies in feature containers and inject focused operations through props.
- Do not use test-framework module mocks, spies, or mock functions for application services, atoms, hooks, globals, or injected operations. Extract pure logic into dependency-free modules, use plain recording functions for injected operations, and provide deterministic test `Layer` implementations at Effect boundaries.
- Show stable user-facing errors and log internal transport or decoder details separately.
- Keep persisted state in its owning module and make each key's global or server/user scope explicit. Never clear storage outside Ryot-owned keys.
- When working on client behavior that integrates with the backend, consult the relevant end-to-end and integration tests under `tests/src/tests/`, along with supporting fixtures in `tests/src/fixtures/` and `tests/src/support/`, to follow established API, authentication, data setup, and async-operation patterns. Reuse those patterns where applicable.
- Keep route and navigation logic in the existing Expo Router and navigation helpers.
- All text inputs must be submittable via Enter. Last field: `onSubmitEditing` + `returnKeyType="go"`. Intermediate fields: `returnKeyType="next"` with focus forwarding.
- Name rendered component tests `*.component.test.tsx` and run them with RNTL/Jest. Keep pure domain and state tests as regular `*.test.ts` files under Vitest.
- Before writing React Native component tests, read the installed RNTL guidance under `node_modules/@testing-library/react-native/docs/`, starting with `docs/guides/llm-guidelines.md`.
- Keep selected upload data file-backed as `Blob` or `File` through the picker, form field, and upload transport. Never read an entire selected file into a `Uint8Array`.
- Stream native downloads into an Expo `FileHandle`. On web, prefer the save-file picker writable; limit the Blob fallback to 50 MiB with both metadata and counted-stream guards.
- Invalidate file-field attempts before opening a picker and on removal or unmount. Picker and upload completions may update state only while their attempt is current.
- Keep native backup share files isolated per transfer. Prune only Ryot-owned stale cache entries and never remove a transfer that the current runtime may still be sharing.
- Creating a backup restore dispatches the restore run after the account-cleanliness check. The dispatched workflow claims the temporary upload, so claim, archive, or plugin failures belong to run history rather than the create response.
