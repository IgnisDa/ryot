# Compose Public Plugin Components

**Parent Plan:** [Composable Views Tracer](./tracer.md)

**System Design:** [Composable Views](./README.md)

**Status:** todo

**Depends On:** [01 - Publish And Open Custom Pages](./01-publish-and-open-custom-pages.md)

## What To Build

Make an API-published user page import and render public components from a system plugin and the user's privately installed fixture in the same application. The result must use the same React and SDK instances, not nested applications.

Implement [Plugin Public Surface](./tracer.md#plugin-public-surface), [Client Source Import Policy](./tracer.md#client-source-import-policy), [Resolve The Contributor Graph](./tracer.md#resolve-the-contributor-graph), and [Compile And Cache](./tracer.md#compile-and-cache). Public paths are `@ryot-app/plugins/<pluginSlug>/<exportName>`. Resolve them through declared dependencies and the current user's actual installations. Relative paths stay within a contributor.

While the import mechanism is open, keep the trusted client set exact: it gains public plugin exports and must not keep inheriting the neutral shared modules, so contributor `client/**` sources reach one Ryot authoring surface. `shared/**` keeps its narrower plugin-kit-only rule, and classification stays importer-based so a shared file imported from client code is still checked as shared. Task 11 widens the SDK Effect re-export and converts the one plugin client source that currently depends on the plugin kit.

Contributor stylesheets must also stay reachable by the artifact stylesheet scanner. It reads plugin client sources and the UI SDK today, so a utility class authored anywhere else reaches an artifact only by incidental overlap with a scanned file. Decide explicitly whether the scanned source set grows or visual implementations stay in the UI SDK, and record which.

Use small useful domain components for the first proof, then reuse them in later cards/pages. Do not add disposable demonstration exports. Task 03 completes page/route conversion; Task 05 adds rich batch-backed entity presentations.

Namespace contributor source files, generate typed public imports, deduplicate trusted dependencies, combine reachable stylesheets deterministically, and resolve assets relative to their contributor. Validate all advertised exports during plugin packaging/install without executing plugin code in the backend. Builds include only the selected reachable graph, with automatic-provider expansion available for Task 04.

Extend artifact metadata/session validation to the complete code-contributor set. Implement exact graph-based cache identity and preparation race checks now; Task 09 handles the user experience of an already-open page when that identity becomes outdated.

## Acceptance Criteria

- [ ] One user page renders a system media component and a private fixture component through declared public imports.
- [ ] There is one iframe, one bootstrap, one React instance, and one shared SDK context.
- [ ] Public export metadata distinguishes pages, components, and presentations and checks generated imports against the appropriate SDK types.
- [ ] Missing exports, undeclared plugins, traversal, cross-contributor relative paths, backend source, and unsupported packages are rejected clearly.
- [ ] Contributor identity uses the user's resolved stable plugin/installation IDs, not an unscoped slug lookup.
- [ ] Equal relative filenames from different contributors do not collide.
- [ ] Reachable CSS and assets from several contributors work together, with framework/theme styles emitted once.
- [ ] The trusted client import set no longer inherits the neutral shared modules, while `shared/**` keeps its existing plugin-kit-only rule and its shared-source-imported-from-client fixture still compiles.
- [ ] The scanned stylesheet source set is stated explicitly, and no emitted class depends on incidental overlap with an unrelated scanned file.
- [ ] Unrelated plugin page code is not pulled into a user page solely because it imports one public component.
- [ ] Recursive public dependencies and automatic-registry requirements are resolved with cycle-safe traversal and stable ordering.
- [ ] Source/dependency/export/provider-set changes affect build selection; settings values and query results do not become source bytes.
- [ ] Existing access tests include a focused composed-private-dependency case without adding a separate security system.
- [ ] Compiler tests execute the emitted composition and enforce the existing aggregate limits.

## Verification

Extend compiler import, stylesheet, asset, and runtime execution tests. Extend existing fixture install helpers and artifact-access tests instead of duplicating them. The browser proof must use a genuinely private fixture installation and real publication APIs. No live Pokemon provider is required to render a component from deterministic props at this stage.

## User Stories Addressed

- [User story 3](./tracer.md#user-stories): public system/private composition.
- User story 18: existing access rules cover all contributors.
- User story 20: one execution path rather than nested or parallel application systems.

## Implementor Notes

Record compiler graph identities, source namespace conventions, and public-export validation details that later tasks must reuse.
