# App Client Architecture Cleanup Plan

## Objective

Clean up `apps/app-client` without changing intended product behavior. Unify backend scope and transport, remove authenticated-scope prop drilling and redundant guards, simplify saved-view state ownership, stop duplicate revalidation requests, make authentication errors safe and consistent, remove verified dead code, and add tests around the highest-risk flows.

The saved-view search, filter, add, workspace-search, entity-placeholder, and settings-placeholder UI must remain. These controls and routes are intentional scaffolding for later functionality.

## Required Outcome

The completed implementation must satisfy these invariants:

- One canonical `ApiScope` identifies the current authenticated server and user.
- The server URL used in a cache key is the same server URL used by the request transport.
- Authenticated feature code cannot silently fall back to Ryot Cloud or an empty user ID.
- Routes and presentation components do not pass `serverUrl` and `userId` through the tree.
- Saved-view result data has one authoritative state owner.
- Foreground and reconnect events do not start both an ignored atom request and a structural refresh.
- Stale saved-view requests cannot update a new server, user, record, layout, or generation.
- Internal backend and decoder errors are logged but are not rendered directly to users.
- Verified dead exports and dependencies are removed or made genuinely used by replacing duplicate implementations.
- Existing future-facing controls and placeholder routes remain present.

## Constraints

- Do not revert or overwrite unrelated worktree changes. Inspect `git status` and `git diff` before editing.
- Preserve current saved-view behavior: record loading, grid/list/table layouts, persisted layout selection, pagination, managed image resolution, manual refresh, entity-interest hydration, structural refresh, focus refresh, reconnect refresh, and stale-operation protection.
- Preserve server/user partitioning for authenticated caches and persisted state.
- Keep contract clients and HTTP layers under `src/api`.
- Keep request documents, decoders, typed application states, and feature-owned atoms in their owning feature.
- Use application-owned RyotQL documents and existing recipes.
- Do not add compatibility layers for the old internal APIs. Update all app-client consumers in the same change.
- Do not reorganize folders unless a move directly supports one of the boundaries below.
- Consult the relevant backend integration tests under `tests/src/tests/` before changing request or authentication behavior.

## Existing Files To Preserve

Do not remove these intentional future-facing areas:

- Saved-view search, filter, and add controls in `src/modules/saved-views/saved-view-content.tsx`.
- Saved-view search, filter, and add controls in `src/modules/saved-views/saved-view-frame.tsx`.
- Navigation search UI in `src/modules/navigation/sidebar.tsx`.
- Workspace search UI in `src/modules/navigation/workspace-shell.tsx`.
- Entity placeholder route at `src/app/(app)/(shell)/e/[entityId].tsx`.
- Settings placeholder route at `src/app/(app)/(shell)/[workspace]/settings.tsx`.
- `src/modules/ui/bottom-sheet/dialog-accessibility.web.tsx`; Metro resolves this platform file implicitly.

## Phase 1: Establish A Non-Mutating Baseline

1. Inspect `git status --short` and the diffs for changed app-client files.
2. Record any pre-existing failures without changing unrelated files.
3. Run the app-client tests.
4. Run TypeScript without formatting or fixing files.
5. Read the saved-view backend tests and fixtures relevant to record lookup, RyotQL execution, pagination, uploads, and entity-interest updates.

Commands:

```sh
git status --short
bun turbo --filter=@ryot/app-client test
cd apps/app-client && bun x tsc --noEmit --incremental false
```

Do not run the package `check` command until edits are ready because it formats and fixes files.

## Phase 2: Bind Transport To Explicit Server Scope

The current cache keys accept an explicit server URL while normal `AtomHttpApi` transport reads a separate URL from persistent storage. Remove this split source of truth before changing props.

### Transport

Update `src/api/transport.ts` so every constructed request layer is bound to an explicit server URL.

- Replace the stored authenticated request layer with an authenticated request-layer factory that accepts `serverUrl`.
- Replace the stored public request layer with a public request-layer factory that accepts `serverUrl`.
- Change the admin request-layer factory to accept both `serverUrl` and `adminToken`.
- Keep the Expo fetch variant explicit and server-bound.
- Remove `serverUrlReader`, `appStorageLayer`, and persistence dependencies from transport after no caller needs them.
- Normalize the server origin once at the API boundary.
- Continue obtaining the authentication cookie for the bound normalized server.

### API Services

Update `src/api/app-api.ts`, `src/api/admin-api.ts`, and `src/api/query-client.ts` so query and mutation services are created for a specific normalized server URL.

- Keep one shared query-default function for retry, SWR, and idle-TTL policy.
- Do not introduce a process-wide mutable “current server” inside `src/api`.
- If service construction needs caching, key it by normalized server URL and keep the cache private to `src/api`.
- Ensure admin services are bound to the same `serverUrl` represented by `GodModeScope`.
- Ensure public system-configuration queries target the `serverUrl` represented by their request key.

### Feature Call Sites

Update all affected callers:

- `src/modules/server/atoms.ts`
- `src/modules/navigation/atoms.ts`
- `src/modules/saved-views/atoms.ts`
- `src/modules/god-mode/atoms.ts`
- `src/api/queries.ts`
- `src/modules/entity-interest/provider.tsx`

At each call site, use the same canonical scope value for both the atom key and API service construction. A request keyed for server A must never be able to target server B.

### Transport Tests

Add or update tests under `src/api` to prove:

- Public, authenticated, Expo, and admin clients use the explicitly supplied normalized origin.
- Authentication cookies are read for that same origin.
- Admin headers remain request-local.
- Constructing clients for two server URLs does not cross their destinations.
- No authenticated or public request path reads the persisted server URL implicitly.

## Phase 3: Add One Authenticated Application Scope Boundary

Create a small authenticated API-scope context under `src/api`. It should expose the existing `ApiScope` type rather than defining a mirror.

The boundary must:

- Accept `{ serverUrl, userId }` only after both values are available.
- Canonicalize the scope with `canonicalApiScope`.
- Expose a strict hook such as `useApiScope()` that throws when used outside the authenticated provider.
- Remount scope-owned runtime resources when the canonical server or user changes.
- Avoid optional scope values inside authenticated descendants.

Install the provider in `src/app/(app)/_layout.tsx` after the existing server and session gates. Place `EntityInterestProvider` inside it and make entity interest read the canonical scope from the context instead of receiving `serverUrl` and `userId` props.

Update authenticated descendants to use the boundary:

- `src/app/(app)/index.tsx`
- `src/app/(app)/(shell)/(drawer)/v/[viewSlug].tsx`
- `src/modules/navigation/use-workspace-navigation.ts`
- `src/modules/saved-views/use-saved-view.tsx`
- `src/modules/saved-views/saved-view-filter-sheet.tsx`
- Any saved-view layout persistence hook or container introduced during this work.

Remove these redundant authenticated-state fallbacks after the provider is in place:

- Repeated session and server loading/error branches in the saved-view route.
- The cloud fallback and null-session branch in the authenticated app index.
- `unavailableNavigationAtom` and `unavailableWorkspaceAtom`.
- The cloud fallback in workspace navigation.
- The cloud and empty-user fallbacks in the saved-view filter sheet.

Do not remove the gates in `src/app/(app)/_layout.tsx`; those are the authoritative route boundary.

## Phase 4: Stop Passing Infrastructure Scope Through Saved-View UI

Change saved-view public interfaces so they accept domain inputs rather than backend identity.

Target interfaces:

- `useSavedViewRecord(slug)` instead of accepting a record scope object.
- `useSavedViewResult(record)` instead of accepting server, user, and record.
- Managed-asset resolution obtains `ApiScope` inside the feature data boundary.
- Layout persistence obtains `ApiScope` inside a feature hook or container.
- `SavedViewReadyContent`, `SavedViewDisplay`, and `SavedViewWebActions` do not accept `serverUrl` or `userId`.
- `SavedViewLayoutSelector` is presentation-only and receives layout value and change behavior, or is wrapped by one feature container that owns persistence. It must not accept infrastructure identity.

Reuse `ApiScope` everywhere a scope type is still required. Delete the mirrored local `Scope` type in `use-saved-view.tsx`.

Keep server URL use inside data work where it is semantically required, such as resolving an API-relative managed download URL. Do not pass it into presentation solely to reach that data work.

## Phase 5: Give Saved-View Results One State Owner

Replace the hybrid of SWR query atoms, mutable `useRef` cache, manual rerender counters, and direct Effect requests.

Use one feature-owned controller/state machine as the authority for saved-view result pages. Prefer an immutable reducer or feature store with explicit events over mutating `RuntimeCache` and forcing renders.

The state model must represent:

- Current identity: canonical API scope, record ID, record update timestamp, and active layout.
- Per-layout loaded pages and normalized items.
- Initial and load-more request state.
- Manual structural refresh state.
- Generation or operation token used to reject stale responses.
- Stable transport and malformed-result failures.

The controller must own these transitions:

- Identity change resets all state and cancels or invalidates old work.
- Layout change preserves valid per-layout data but invalidates old in-flight operations.
- Initial load replaces the target layout data.
- Load more appends one page and deduplicates entities.
- Manual or structural refresh replaces the currently loaded page range.
- Entity hydration patches only requested, currently loaded entities.
- A structural dirty event schedules one bounded refresh.
- A stale completion cannot update state.

Use one request execution path for initial load, pagination, structural replacement, and hydration. It must call the server-bound API from Phase 2.

Remove obsolete result-query layers after the controller owns request execution:

- Remove `savedViewResultAtom` if it no longer has an independent consumer.
- Remove `savedViewResultStateAtom` and its duplicate response mapping layer if no longer required.
- Remove mutable `RuntimeCache`, fake `rerender` state, and direct object mutation.
- Keep `savedViewRecordAtom`, managed-asset resolution, and persisted layout atoms only if they remain clear single-purpose resources.
- Keep pure decoding and normalized-state helpers where they remain useful.

Do not fold record lookup, managed-asset resolution, or presentation rendering into the result controller.

## Phase 6: Remove Duplicate Focus And Reconnect Requests

After Phase 5, assign foreground/reconnect refresh ownership to one layer.

- Saved-view loaded-page refresh should run through the saved-view controller because it must replace all currently loaded pages.
- Do not keep a subscribed SWR result atom that independently revalidates and whose result is ignored.
- Keep global query-client focus behavior for ordinary query atoms such as record, navigation, and configuration queries.
- Ensure one foreground event starts at most one saved-view structural refresh.
- Ensure one reconnect transition starts at most one saved-view structural refresh.
- Coalesce repeated triggers while a refresh is active using the existing structural refresh semantics.

Add a test with a counted fake executor proving that foreground or reconnect does not issue an extra discarded request.

## Phase 7: Make Error Handling Consistent

Update `src/modules/auth/form.tsx` and `src/app/reset-password.tsx`.

- Do not render `result.error.message` or caught `Error.message` directly.
- Map expected authentication outcomes to stable operation-specific user copy.
- Log internal Better Auth, transport, and unexpected error details separately.
- Preserve distinct useful messages for invalid credentials, failed signup, invalid two-factor code, failed OIDC, and failed password reset when reliable error codes are available.
- Consult current Better Auth documentation before depending on error-code fields.
- Keep logs free of passwords, reset tokens, two-factor codes, cookies, and admin tokens.

Add tests for application-owned error mapping. Test the mapping and branching, not Better Auth itself.

## Phase 8: Remove Verified Dead And Duplicate Code

Apply these cleanups after structural changes settle:

- Remove the unused `SavedViewRecordState` type from `src/modules/saved-views/state.ts`.
- Resolve `src/modules/saved-views/saved-view-value.tsx` and the duplicate local `Value` components in grid and list. Prefer one shared active component and delete the two duplicate implementations. If the refactored renderers no longer benefit from a component, delete all three and render through one other active abstraction. Do not leave the file orphaned.
- Remove `@expo/material-symbols` from `apps/app-client/package.json` with `bun remove` from the app-client package directory.
- Update the lockfile only through Bun.
- Do not remove framework, config-plugin, platform-resolution, or peer dependencies merely because application source does not import them directly.

Run a final import search to confirm there are no orphaned non-route production files. Treat Expo Router route files and `.web.tsx` platform files as implicit entry points where applicable.

## Phase 9: Tests And Verification

Preserve and adapt existing saved-view unit tests. Add focused tests for application behavior introduced by the refactor.

Required test cases:

- API scope canonicalizes equivalent server origins.
- Server and user changes partition request state and persisted layout state.
- Request destination and request key always use the same server.
- Saved-view identity change rejects stale completion from the previous identity.
- Layout change rejects stale completion from the previous layout.
- Initial load, pagination, and full replacement preserve page order and deduplicate entities.
- Entity hydration patches loaded entities without adding unrelated entities.
- Foreground and reconnect triggers each produce one structural refresh.
- Concurrent dirty events coalesce according to the structural refresh policy.
- Managed assets resolve relative URLs against the same server that returned them.
- Auth failures show stable copy and log internal details without secrets.

Final commands:

```sh
bun turbo --filter=@ryot/app-client test
bun turbo --filter=@ryot/app-client check
bun turbo --filter=@ryot/app-client build
git status --short
git diff --check
```

After `check`, inspect the diff because that command writes formatting and lint fixes. Re-run tests if it changes source.

## Completion Criteria

The work is complete only when all statements are true:

- No app-client transport reads a hidden persisted server URL for a request keyed by an explicit scope.
- `src/api` is the only place that constructs contract clients and HTTP layers.
- The authenticated route layout is the only owner of missing-server and missing-session gating for authenticated descendants.
- Saved-view route and presentation props contain no `serverUrl` or `userId`.
- Saved-view result state has no mutable ref cache plus atom cache duplication.
- Foreground and reconnect handling has one request owner.
- Existing saved-view functionality and future-facing scaffold controls remain.
- No raw internal authentication error is rendered.
- The verified unused type and dependency are gone.
- The saved-view value rendering implementation is not duplicated or orphaned.
- Tests, check, and web build pass.
- Unrelated worktree changes remain intact.

## Final Review Guidance

Review the final diff as an architecture change, not only as a compilation fix. Pay special attention to request cancellation, stale responses, server changes, provider remounting, and whether any fallback silently recreates the old two-source-of-truth design.

Keep the final implementation smaller than the current one where possible. Do not replace the existing complexity with generic repositories, service locators, or speculative framework abstractions.

## Implementation Record

Status: Completed on 2026-08-15.

- Bound public, authenticated, Expo, and admin transports and API services to an explicit normalized server URL.
- Added a strict canonical authenticated `ApiScope` boundary and removed authenticated server/user prop drilling and fallbacks.
- Replaced the saved-view result atom/ref hybrid with one reducer-owned controller using operation tokens, per-layout pages, and one coalesced structural refresh path.
- Preserved saved-view controls, navigation and workspace search, placeholder routes, managed assets, layout persistence, pagination, hydration, and refresh behavior.
- Mapped authentication failures to stable operation-specific copy and restricted diagnostics to allowlisted, non-secret metadata.
- Removed the unused saved-view record state and dependency, and consolidated saved-view value rendering.
- Added focused tests for transport binding, scope partitioning, stale operations, pagination and replacement, hydration, refresh coalescing, managed assets, authentication errors, and caller failure branches.

Review findings and resolutions:

- Fixed JSON and nested authentication secrets reaching logs by removing arbitrary error-message logging.
- Fixed retained structural refreshes remaining blocked after initial, pagination, or active refresh work completed.
- Replaced callback-only refresh tests with deferred counted-executor coverage through the real reducer and refresh service.
- Added direct request-key/server coupling, multi-page load-more/replacement, and caller-level authentication branch tests.
- Final re-review found no critical or high-confidence regressions; its remaining caller-branch test gap was addressed without another review cycle.

Verification completed:

- `bun turbo --filter=@ryot/app-client test`
- `cd apps/app-client && bun x tsc --noEmit --incremental false`
- `bun turbo --filter=@ryot/app-client check`
- `bun turbo --filter=@ryot/app-client build`
- Affected backend e2e files: saved views, RyotQL, RyotQL authorization, uploads, entity-interest authorization, and entity-interest population dispatch; 28 tests passed.
- `git diff --check`

No implementation blockers, plan deviations, or required scope expansions occurred. The affected e2e run emitted one non-fatal plugin cleanup warning because test entities still referenced the temporary plugin; the suite passed.
