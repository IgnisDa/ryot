# Kernel Client

- Read `README.md` before changing page hosting, bridge lifecycle, navigation, or native integration.
- Keep routes as React adapters using shared Ryot queries/mutations. Loaders handle access, redirects, and not-found checks; pre-auth, token-scoped admin, and catalog-dependent workspace redirects remain direct-service exceptions.
- Keep generated contract clients in `#/api`; only `AuthenticatedApi` and `AdminApi` execute contract programs. Live client Layers must construct synchronously.
- The kernel owns authentication, server selection, history, artifacts, bridge dispatch, and native authority. Expose only semantic, environment-neutral plugin capabilities.
- Load authenticated frame documents once into `srcdoc` with exactly `sandbox="allow-scripts"`. Never assign iframe `src`, change a live frame's `srcdoc`, or expose bearer credentials/upload URLs to plugins.
- Preserve opaque-origin isolation and embedded artifact identity checks. Suppress interrupted or stale bridge replies; classify expected failures at capability producers.
- Derive entry index/key only through `historyEntry`; page-state replacement retains the key. Prepare plugin routes, entities, saved views, and homes through the canonical client-page preparation path, including hidden installations.
- Keep navigation and hardware Back router-owned; OAuth connection returns are claimed by their live attempt. Read the README before changing this exception or the `/oauth/login` contract.
- The shell owns viewport values and active-entry title authority.
- Render kernel routes through `AppScreen`, mobile headers through `ScreenFrame`, and icons through the UI SDK. Each branch has one `mainContentProps` element and one `usePageTitle` owner; root owns skip-link/announcer behavior.
- Use UI SDK overlay/focus/shortcut primitives and shared focused-field visibility. React-state overlays use `BackInterceptor`; URL-state overlays push history and close by pop.
- Preserve selected uploads as `Blob`/`File` through the SDK capability. Only backup downloads may obtain bearer headers directly.
- Keep native identity in platform configuration and regenerate assets through `bun run generate-assets`, never by editing generated files.
- Render saved views through the shell client-page document host, never a parallel kernel-DOM path. The iframe renderer owns view title and icon. Provider search uses the saved view's explicit `addAction` owner and schema.
- Desktop sidebar and mobile drawer use shared authenticated navigation data; never patch loader data in place.
