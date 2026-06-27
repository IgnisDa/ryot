# Unify Kernel Screen Data Access

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** todo

**Depends On:** [08 - Preserve State During Live Refresh](./08-preserve-state-during-live-refresh.md)

## What To Build

Make the kernel's own authenticated screens use the same query and mutation surface the pages use, so freshness, caching, refresh, and error behaviour cannot differ between a kernel screen and a plugin screen. Today those screens fetch in route loaders and write through direct runtime calls, so they gain none of the revalidation, idle expiry, stale-on-error, or entity-interest coordination the shared surface already implements.

Implement [Host Query Context](./tracer.md#host-query-context). Give the provider an optional host services value, pass it to query and mutation definitions beside the existing client, input, and signal, and remove the existing workaround that reaches the same result by passing a runtime through a query's input. Construct the kernel client once per API scope instead of inside a route loader, and delete the parent-match plumbing that exists only to borrow that loader-created client. Add kernel ownership of active-screen state before any kernel query declares entity interest.

In scope are the authenticated, user-scoped screens: preferences, backups, the integrations index and detail, the import-data index and detail, and account. Convert their reads to query definitions over the existing services and their writes to mutation definitions, and let a successful write refresh its own screen's data through the shared mechanism rather than invalidating the router.

Access decisions stay where they are. `beforeLoad` continues to gate routes, and loader-thrown redirect and not-found signals keep their current behaviour because no hook equivalent exists. The pre-authentication routes sit outside the provider and have no API scope, and the god-mode routes are token-scoped rather than user-scoped; both are permanent named exceptions recorded in the kernel client's stable rules, not deferred work. The workspace redirect that depends on fetched catalog data also stays on the loader, because resolving it in a hook would render a page before replacing it.

Migrated screens lose route-loader prefetching. Show the ordinary pending state and do not keep a loader whose only purpose is to warm the cache.

Also tighten [Client Source Import Policy](./tracer.md#client-source-import-policy): stop the client trusted-module set from inheriting the neutral shared modules, widen the SDK Effect re-export to the namespaces the compiler shim already provides, and move the one plugin client source that imports the plugin kit onto the SDK surface. Keep the shared-source rule and its existing fixture working.

Primary code areas are the SDK React surface, the kernel authenticated route and its client construction, the kernel settings routes and their modules, the client compiler dependency policy, and the SDK Effect entry point.

## Acceptance Criteria

- [ ] The provider accepts host services and supplies them to query and mutation definitions; plugin applications neither supply nor reference them.
- [ ] No query passes a runtime or other host service through its input value, and query-input identity no longer depends on host service identity.
- [ ] The kernel client is constructed once per API scope; repeating an access check or reloading a route does not create a new client identity or discard cached query state.
- [ ] Routes no longer borrow a loader-created client through parent-match plumbing.
- [ ] The kernel owns active-screen state for its screens, and an inactive kernel screen releases entity interest instead of contributing demand.
- [ ] Preferences, backups, integrations index and detail, import-data index and detail, and account read through query definitions and write through mutation definitions.
- [ ] A successful write on those screens refreshes its own data through the shared mechanism, with no router invalidation left as the refresh trigger.
- [ ] Those screens revalidate on return to the application and keep previously loaded content visible when a refresh fails.
- [ ] `beforeLoad` access decisions, loader redirects, not-found signals, and the catalog-dependent workspace redirect keep their current behaviour.
- [ ] The pre-authentication and god-mode exceptions are recorded as permanent named rules rather than open items.
- [ ] No kernel-only capability category is added to the client capability object.
- [ ] A plugin `client/**` source importing the plugin kit fails with a named import diagnostic, while the same import from a shared source still compiles.
- [ ] The SDK Effect re-export, the compiler Effect shim, and the pinned deep-import resolver name the same namespace set.
- [ ] No migrated screen retains a cache-priming loader or a second prefetch trigger.

## Verification

Use the parent plan's [Testing And Validation](./tracer.md#testing-and-validation) conventions. Extend the SDK React surface tests for host services, client identity, and active-screen release. Rewrite the existing kernel settings route tests onto the shared query surface rather than deleting their coverage, and assert the refresh path rather than a router invalidation call. Add compiler cases for the rejected client-source plugin-kit import and the still-valid shared-source import, and keep the existing shared-source-imported-from-client fixture compiling. Prove revalidation and stale-on-error behaviour through real signals, not by replacing component props by hand.

## User Stories Addressed

References are to [User Stories](./tracer.md#user-stories) in the parent plan:

- [User story 21](./tracer.md#user-stories): settings screens stay as fresh as page screens.
- User story 22: one query surface and one cache across kernel and plugin screens.
- User story 23: the client import surface is exactly one SDK surface.
- User story 20: one execution path rather than competing data-access systems.

## Implementor Notes

Record the final host services shape, the client construction site, the active-screen ownership decision, and the exact namespace set shared by the Effect re-export, shim, and resolver. List the permanent exception routes with the reason each cannot use the shared surface. Do not use this section to defer acceptance criteria to the cutover or cleanup tasks.
