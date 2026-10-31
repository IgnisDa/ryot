import { assert, expect, it } from "@effect/vitest";
import type {
	ClientPageCompositionIdentity,
	ClientPageCompositionManifest,
} from "@ryot-app/contract/modules/pages/schemas";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { pluginExportSpecifier } from "@ryot-app/plugin-client-contract";
import { Effect } from "effect";

import { fixtureManifest, testPluginPackageId } from "#modules/plugins/test-support";

import { type ArtifactDescription, composeClientPage } from "./composition";
import type { GraphPlugin } from "./graph";
import { resolveClientPageGraph } from "./graph";

const packageIds = new Map<string, PluginPackageId>();
const packageIdFor = (name: string) => {
	const existing = packageIds.get(name);
	if (existing) {
		return existing;
	}
	const packageId = testPluginPackageId();
	packageIds.set(name, packageId);
	return packageId;
};
const dependencyReference = (name: string) => ({
	scope: "user" as const,
	packageId: packageIdFor(name),
});

const plugin = (name: string, client: NonNullable<PluginManifest["client"]>): GraphPlugin => {
	const manifest = fixtureManifest();
	return {
		scope: "user",
		health: "ready",
		isHidden: false,
		id: `${name}-id`,
		clientImports: [],
		contentHash: `${name}-source`,
		packageId: packageIdFor(name),
		clientArtifactHash: `${name}-hash`,
		pluginRevisionId: `${name}-revision`,
		manifest: { ...manifest, client, metadata: { name: manifest.metadata.name } },
	};
};

const analyticsGraph = (plugins: readonly GraphPlugin[]) =>
	resolveClientPageGraph({
		plugins,
		kernel: true,
		clientImports: [],
		rendererName: "Analytics",
		sourceHash: "analytics-source",
		runtimeArtifactHash: "runtime",
		rendererArtifactHash: "renderer",
		definition: {
			files: [],
			pluginDependencies: {},
			analyticsSections: true,
			entry: "client/analytics.tsx",
			settingsSchema: { fields: {} },
			automaticEntityPresentations: false,
		},
	});

type Page<Value> = Extract<Value, { readonly application: "page" }>;
function pageSections(
	value: ClientPageCompositionIdentity,
): Page<ClientPageCompositionIdentity>["analyticsSections"];
function pageSections(
	value: ClientPageCompositionManifest["descriptor"],
): Page<ClientPageCompositionManifest["descriptor"]>["analyticsSections"];
function pageSections(
	value: ClientPageCompositionIdentity | ClientPageCompositionManifest["descriptor"],
) {
	assert(value.application === "page");
	return value.analyticsSections;
}

const analyticsPlugin = (name: string) =>
	plugin(name, {
		apiVersion: 1,
		homeView: null,
		analyticsSections: {
			activity: { sortOrder: 0, name: "Activity", icon: "chart-column", exportName: "activity" },
		},
		exports: {
			activity: {
				kind: "analytics-section",
				entry: "client/activity.tsx",
				automaticEntityPresentations: false,
			},
		},
	});

it.effect(
	"composes generic analytics sections with exact private dependencies and lazy styles",
	() =>
		Effect.gen(function* () {
			const dependency = plugin("analytics-dependency", {
				apiVersion: 1,
				homeView: null,
				exports: {
					shared: {
						kind: "component",
						entry: "client/shared.tsx",
						automaticEntityPresentations: false,
					},
				},
			});
			const original = analyticsPlugin("analytics-owner");
			const client = original.manifest.client;
			assert(client);
			const owner = {
				...original,
				manifest: {
					...original.manifest,
					client: {
						...client,
						pluginDependencies: { shared: dependencyReference("analytics-dependency") },
					},
				},
			};
			const other = analyticsPlugin("analytics-other");
			const graph = yield* analyticsGraph([other, owner, dependency]);
			expect(yield* analyticsGraph([dependency, owner, other])).toEqual(graph);
			expect(graph.identity.eagerArtifactHashes).toEqual(["renderer", "runtime"]);
			expect(pageSections(graph.identity)).toHaveLength(2);
			expect(
				pageSections(graph.identity).find(({ ownerPluginId }) => ownerPluginId === owner.id),
			).toMatchObject({
				slug: "activity",
				artifactClosure: ["analytics-dependency-hash", "analytics-owner-hash"],
				module: { binding: "activity", specifier: pluginExportSpecifier(owner, "activity") },
			});
			const manifest = composeClientPage({
				identity: graph.identity,
				runtimeEntries: { bootstrap: "bootstrap.js" },
				artifacts: new Map<string, ArtifactDescription>([
					["runtime", { files: [{ name: "bootstrap.js", contentType: "text/javascript" }] }],
					...[
						"renderer",
						"analytics-owner-hash",
						"analytics-other-hash",
						"analytics-dependency-hash",
					].map(
						(hash) =>
							[
								hash,
								{
									files: [
										{ name: "module.js", contentType: "text/javascript" },
										{ name: "module.css", contentType: "text/css" },
									],
								},
							] as const,
					),
				]),
			});
			expect(manifest.imports[pluginExportSpecifier(dependency, "shared")]).toEqual({
				file: "module.js",
				artifactHash: "analytics-dependency-hash",
			});
			expect(
				pageSections(manifest.descriptor).find(({ ownerPluginId }) => ownerPluginId === owner.id)
					?.stylesheets,
			).toEqual([
				{ file: "module.css", artifactHash: "analytics-dependency-hash" },
				{ file: "module.css", artifactHash: "analytics-owner-hash" },
			]);
			expect(
				(yield* analyticsGraph([owner, { ...other, pluginRevisionId: "new-revision" }, dependency]))
					.compositionKey,
			).not.toBe(graph.compositionKey);
			expect(
				pageSections(
					(yield* analyticsGraph([{ ...owner, isHidden: true }, other, dependency])).identity,
				),
			).toHaveLength(1);
		}),
);

it.effect(
	"isolates missing analytics artifacts and dependencies without granting partial contributors",
	() =>
		Effect.gen(function* () {
			const original = analyticsPlugin("unavailable-owner");
			const client = original.manifest.client;
			assert(client);
			const broken = {
				...original,
				manifest: {
					...original.manifest,
					client: {
						...client,
						pluginDependencies: { missing: dependencyReference("uninstalled") },
					},
				},
			};
			const good = analyticsPlugin("ready-owner");
			const graph = yield* analyticsGraph([broken, good]);
			expect(
				pageSections(graph.identity).find(({ ownerPluginId }) => ownerPluginId === broken.id),
			).toMatchObject({ module: null, artifactClosure: [] });
			expect(
				graph.identity.contributors.flatMap((contributor) =>
					contributor.kind === "plugin" ? [contributor.pluginId] : [],
				),
			).toEqual([good.id]);
			const missingArtifact = yield* analyticsGraph([{ ...good, clientArtifactHash: null }]);
			expect(pageSections(missingArtifact.identity)[0]?.module).toBeNull();
			expect(pageSections((yield* analyticsGraph([])).identity)).toEqual([]);
		}),
);

it.effect("keeps unavailable lazy analytics sections out of automatic presentation inference", () =>
	Effect.gen(function* () {
		const healthySection = plugin("healthy-section", {
			apiVersion: 1,
			homeView: null,
			analyticsSections: {
				activity: { sortOrder: 0, name: "Activity", icon: "chart-column", exportName: "activity" },
			},
			exports: {
				activity: {
					kind: "analytics-section",
					entry: "client/activity.tsx",
					automaticEntityPresentations: false,
				},
				unrelatedPage: {
					kind: "page",
					entry: "client/page.tsx",
					settingsSchema: { fields: {} },
					automaticEntityPresentations: true,
				},
			},
		});
		const unavailableSection = plugin("unavailable-section", {
			apiVersion: 1,
			homeView: null,
			entities: { entity: { gridPresentation: "card" } },
			pluginDependencies: { missing: dependencyReference("unavailable-dependency") },
			analyticsSections: {
				activity: { sortOrder: 0, name: "Activity", icon: "chart-column", exportName: "activity" },
			},
			exports: {
				card: {
					kind: "presentation",
					entry: "client/card.tsx",
					automaticEntityPresentations: false,
				},
				activity: {
					kind: "analytics-section",
					entry: "client/activity.tsx",
					automaticEntityPresentations: false,
				},
			},
		});
		const graph = yield* analyticsGraph([healthySection, unavailableSection]);

		expect(
			pageSections(graph.identity).find(({ ownerPluginId }) => ownerPluginId === healthySection.id),
		).toMatchObject({ module: { binding: "activity" } });
		expect(
			pageSections(graph.identity).find(
				({ ownerPluginId }) => ownerPluginId === unavailableSection.id,
			),
		).toMatchObject({ module: null, artifactClosure: [] });
		expect(graph.identity.automaticRegistry).toEqual([]);
		expect(graph.identity.kernelAutomaticFallback).toBeNull();
		expect(graph.identity.eagerArtifactHashes).toEqual(["renderer", "runtime"]);
	}),
);

it.effect("composes explicit plugin routes without inventing a home route", () =>
	Effect.gen(function* () {
		const page = plugin("rootless", {
			apiVersion: 1,
			homeView: null,
			routes: { "/items/new": "create", "/items/$id/edit": "edit" },
			exports: Object.fromEntries(
				["create", "edit"].map((name) => [
					name,
					{
						kind: "page" as const,
						entry: `client/${name}.tsx`,
						settingsSchema: { fields: {} },
						automaticEntityPresentations: false,
					},
				]),
			),
		});
		const input = {
			plugin: page,
			plugins: [page],
			exportName: "create",
			runtimeArtifactHash: "runtime",
			application: "plugin-route" as const,
		};
		const graph = yield* resolveClientPageGraph(input);
		expect(yield* resolveClientPageGraph({ ...input, exportName: "edit" })).toEqual(graph);
		const manifest = composeClientPage({
			identity: graph.identity,
			runtimeEntries: { bootstrap: "bootstrap.js" },
			artifacts: new Map([
				["runtime", { files: [{ name: "bootstrap.js", contentType: "text/javascript" }] }],
				["rootless-hash", { files: [{ name: "module.js", contentType: "text/javascript" }] }],
			]),
		});
		expect(manifest.descriptor).toEqual({
			automaticRegistry: [],
			application: "plugin-route",
			routes: {
				routes: [
					{
						path: "/items/new",
						module: { binding: "create", specifier: pluginExportSpecifier(page, "create") },
					},
					{
						path: "/items/$id/edit",
						module: { binding: "edit", specifier: pluginExportSpecifier(page, "edit") },
					},
				],
			},
		});
	}),
);

it.effect("keeps eager dependencies separate from presentation-only transitive artifacts", () => {
	const dependency = plugin("dependency", { exports: {}, apiVersion: 1, homeView: null });
	const presentation = plugin("presentation", {
		apiVersion: 1,
		homeView: null,
		entities: { entity: { gridPresentation: "card" } },
		pluginDependencies: { dependency: dependencyReference("dependency") },
		exports: {
			card: { kind: "presentation", entry: "client/card.tsx", automaticEntityPresentations: false },
		},
	});
	const page = plugin("page", {
		apiVersion: 1,
		homeView: null,
		exports: {
			main: {
				kind: "page",
				entry: "client/page.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: true,
			},
		},
	});
	return Effect.gen(function* () {
		const input = {
			plugin: page,
			exportName: "main",
			application: "page" as const,
			runtimeArtifactHash: "runtime-hash",
			plugins: [page, dependency, presentation],
		};
		const first = yield* resolveClientPageGraph(input);
		const reordered = yield* resolveClientPageGraph({
			...input,
			plugins: [presentation, page, dependency],
		});
		expect(first).toEqual(reordered);
		expect(first.identity.eagerArtifactHashes).toEqual(["page-hash", "runtime-hash"]);
		expect(first.identity.automaticRegistry[0]?.artifactClosure).toEqual([
			"dependency-hash",
			"presentation-hash",
		]);
		const changed = yield* resolveClientPageGraph({ ...input, runtimeArtifactHash: "new-runtime" });
		expect(changed.compositionKey).not.toBe(first.compositionKey);
	});
});

it.effect("stores route modules with home, ordered routes, and not-found bindings", () =>
	Effect.gen(function* () {
		const page = plugin("routes", {
			apiVersion: 1,
			homeView: null,
			notFoundPage: "not-found",
			routes: { "/": "home", "/items/$id": "detail", "/items/new": "create" },
			exports: Object.fromEntries(
				["home", "detail", "create", "not-found"].map((name) => [
					name,
					{
						kind: "page" as const,
						entry: "client/page.tsx",
						settingsSchema: { fields: {} },
						automaticEntityPresentations: false,
					},
				]),
			),
		});
		const graph = yield* resolveClientPageGraph({
			plugin: page,
			plugins: [page],
			exportName: "detail",
			application: "plugin-route",
			runtimeArtifactHash: "runtime",
		});
		const manifest = composeClientPage({
			identity: graph.identity,
			runtimeEntries: { bootstrap: "bootstrap.js" },
			artifacts: new Map([
				["runtime", { files: [{ name: "bootstrap.js", contentType: "text/javascript" }] }],
				["routes-hash", { files: [{ name: "module.js", contentType: "text/javascript" }] }],
			]),
		});
		const expectedRoutes = {
			home: { binding: "home", specifier: pluginExportSpecifier(page, "home") },
			notFound: { binding: "not-found", specifier: pluginExportSpecifier(page, "not-found") },
			routes: [
				{
					path: "/items/new",
					module: { binding: "create", specifier: pluginExportSpecifier(page, "create") },
				},
				{
					path: "/items/$id",
					module: { binding: "detail", specifier: pluginExportSpecifier(page, "detail") },
				},
			],
		};
		expect(graph.identity.application).toBe("plugin-route");
		if (graph.identity.application === "plugin-route") {
			expect(graph.identity.routes).toEqual(expectedRoutes);
		}
		expect(manifest.descriptor).toEqual({
			automaticRegistry: [],
			routes: expectedRoutes,
			application: "plugin-route",
		});
	}),
);

it.effect("eager wins over presentation-only dependencies", () => {
	const page = plugin("page", {
		apiVersion: 1,
		homeView: null,
		pluginDependencies: { dependency: dependencyReference("dependency") },
		exports: {
			main: {
				kind: "page",
				entry: "client/page.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: true,
			},
		},
	});
	const dependency = plugin("dependency", {
		apiVersion: 1,
		homeView: null,
		entities: { entity: { listPresentation: "card" } },
		exports: {
			card: { kind: "presentation", entry: "client/card.tsx", automaticEntityPresentations: false },
		},
	});
	return Effect.gen(function* () {
		const graph = yield* resolveClientPageGraph({
			plugin: page,
			exportName: "main",
			application: "page",
			plugins: [page, dependency],
			runtimeArtifactHash: "runtime",
		});
		expect(graph.identity.eagerArtifactHashes).toContain("dependency-hash");
		expect(graph.identity.automaticRegistry[0]?.artifactClosure).toEqual(["dependency-hash"]);
	});
});

it.effect("binds exports by their declared names including punctuation", () => {
	const page = plugin("page", {
		apiVersion: 1,
		homeView: null,
		exports: Object.fromEntries(
			["a_b", "a-b"].map((name) => [
				name,
				{
					kind: "page" as const,
					entry: `client/${name}.tsx`,
					settingsSchema: { fields: {} },
					automaticEntityPresentations: false,
				},
			]),
		),
	});
	return Effect.gen(function* () {
		const input = {
			plugin: page,
			plugins: [page],
			exportName: "a_b",
			application: "page" as const,
			runtimeArtifactHash: "runtime",
		};
		const graph = yield* resolveClientPageGraph(input);
		expect(graph.identity.application).toBe("page");
		if (graph.identity.application === "page") {
			expect(graph.identity.entry).toEqual({
				binding: "a_b",
				specifier: pluginExportSpecifier(page, "a_b"),
			});
		}
		expect(
			(yield* resolveClientPageGraph({ ...input, exportName: "a-b" })).compositionKey,
		).not.toBe(graph.compositionKey);
		const manifest = composeClientPage({
			identity: graph.identity,
			runtimeEntries: { bootstrap: "bootstrap.js" },
			artifacts: new Map([
				["page-hash", { files: [{ name: "module.js", contentType: "text/javascript" }] }],
				["runtime", { files: [{ name: "bootstrap.js", contentType: "text/javascript" }] }],
			]),
		});
		expect(manifest.descriptor.application).toBe("page");
		if (manifest.descriptor.application === "page") {
			expect(manifest.descriptor.entry).toEqual({
				binding: "a_b",
				specifier: pluginExportSpecifier(page, "a_b"),
			});
		}
	});
});

it.effect("binds equal metadata names and importer-local aliases to independent packages", () =>
	Effect.gen(function* () {
		const pageExport = {
			kind: "page" as const,
			entry: "client/page.tsx",
			settingsSchema: { fields: {} },
			automaticEntityPresentations: false,
		};
		const leftDependency = plugin("left-dependency", {
			apiVersion: 1,
			homeView: null,
			exports: {
				common: {
					kind: "component",
					entry: "client/common.tsx",
					automaticEntityPresentations: false,
				},
			},
		});
		const rightDependency = plugin("right-dependency", {
			apiVersion: 1,
			homeView: null,
			exports: {
				common: {
					kind: "component",
					entry: "client/common.tsx",
					automaticEntityPresentations: false,
				},
			},
		});
		const left = plugin("left", {
			apiVersion: 1,
			homeView: null,
			exports: { main: pageExport },
			pluginDependencies: { whiskey: dependencyReference("left-dependency") },
		});
		const right = plugin("right", {
			apiVersion: 1,
			homeView: null,
			exports: { main: pageExport },
			pluginDependencies: { whiskey: dependencyReference("right-dependency") },
		});
		const root = plugin("root", {
			apiVersion: 1,
			homeView: null,
			exports: { main: pageExport },
			pluginDependencies: {
				left: dependencyReference("left"),
				right: dependencyReference("right"),
			},
		});
		const plugins = Array.from([root, left, right, leftDependency, rightDependency], (entry) => ({
			...entry,
			manifest: { ...entry.manifest, metadata: { ...entry.manifest.metadata, name: "Whiskey" } },
		}));
		const graph = yield* resolveClientPageGraph({
			plugins,
			plugin: root,
			exportName: "main",
			application: "page",
			runtimeArtifactHash: "runtime",
		});
		expect(graph.identity.contributors.filter(({ kind }) => kind === "plugin")).toHaveLength(5);
		const manifest = composeClientPage({
			identity: graph.identity,
			runtimeEntries: { bootstrap: "bootstrap.js" },
			artifacts: new Map<string, ArtifactDescription>([
				["runtime", { files: [{ name: "bootstrap.js", contentType: "text/javascript" }] }],
				...[
					"root-hash",
					"left-hash",
					"right-hash",
					"left-dependency-hash",
					"right-dependency-hash",
				].map(
					(hash) =>
						[hash, { files: [{ name: "module.js", contentType: "text/javascript" }] }] as const,
				),
			]),
		});
		for (const [contributor, name] of [
			[leftDependency, "common"],
			[rightDependency, "common"],
			[left, "main"],
			[right, "main"],
		] as const) {
			expect(manifest.imports[pluginExportSpecifier(contributor, name)]).toEqual({
				file: "module.js",
				artifactHash: contributor.clientArtifactHash,
			});
		}
	}),
);

it.effect("keeps the exact selected export when pages share a source entry", () =>
	Effect.gen(function* () {
		const declaration = {
			kind: "page" as const,
			entry: "client/page.tsx",
			settingsSchema: { fields: {} },
			automaticEntityPresentations: false,
		};
		const page = plugin("shared-source", {
			apiVersion: 1,
			homeView: null,
			exports: { first: declaration, second: declaration },
		});
		const input = {
			plugin: page,
			plugins: [page],
			exportName: "second",
			application: "page" as const,
			runtimeArtifactHash: "runtime",
		};
		const graph = yield* resolveClientPageGraph(input);
		const manifest = composeClientPage({
			identity: graph.identity,
			runtimeEntries: { bootstrap: "bootstrap.js" },
			artifacts: new Map([
				["runtime", { files: [{ name: "bootstrap.js", contentType: "text/javascript" }] }],
				["shared-source-hash", { files: [{ name: "module.js", contentType: "text/javascript" }] }],
			]),
		});
		expect(manifest.descriptor).toEqual({
			application: "page",
			analyticsSections: [],
			automaticRegistry: [],
			entry: { binding: "second", specifier: pluginExportSpecifier(page, "second") },
		});
		expect(
			(yield* resolveClientPageGraph({ ...input, exportName: "first" })).compositionKey,
		).not.toBe(graph.compositionKey);
	}),
);

it.effect("stores and composes the kernel page binding directly", () =>
	Effect.gen(function* () {
		const graph = yield* resolveClientPageGraph({
			plugins: [],
			kernel: true,
			clientImports: [],
			rendererName: "renderer",
			sourceHash: "kernel-source",
			runtimeArtifactHash: "runtime",
			rendererArtifactHash: "renderer-hash",
			definition: {
				files: [],
				pluginDependencies: {},
				analyticsSections: false,
				entry: "client/page.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
			},
		});
		const manifest = composeClientPage({
			identity: graph.identity,
			runtimeEntries: { bootstrap: "bootstrap.js" },
			artifacts: new Map([
				["runtime", { files: [{ name: "bootstrap.js", contentType: "text/javascript" }] }],
				["renderer-hash", { files: [{ name: "module.js", contentType: "text/javascript" }] }],
			]),
		});
		expect(manifest.descriptor).toEqual({
			application: "page",
			analyticsSections: [],
			automaticRegistry: [],
			entry: { binding: "page", specifier: "@ryot-app/kernel-renderers/renderer" },
		});
		expect(manifest.imports["@ryot-app/kernel-renderers/renderer"]).toEqual({
			file: "module.js",
			artifactHash: "renderer-hash",
		});
	}),
);

it.effect("reports dependency cycles and never substitutes a same-name package", () =>
	Effect.gen(function* () {
		const pageExport = {
			kind: "page" as const,
			entry: "client/page.tsx",
			settingsSchema: { fields: {} },
			automaticEntityPresentations: false,
		};
		const left = plugin("cycle-left", {
			apiVersion: 1,
			homeView: null,
			exports: { main: pageExport },
			pluginDependencies: { next: dependencyReference("cycle-right") },
		});
		const right = plugin("cycle-right", {
			apiVersion: 1,
			homeView: null,
			exports: { main: pageExport },
			pluginDependencies: { next: dependencyReference("cycle-left") },
		});
		const input = {
			plugin: left,
			exportName: "main",
			plugins: [left, right],
			application: "page" as const,
			runtimeArtifactHash: "runtime",
		};
		expect((yield* Effect.flip(resolveClientPageGraph(input))).reason).toEqual({
			code: "dependency-cycle",
			pluginIds: [left.id, right.id, left.id],
		});
		expect(
			(yield* Effect.flip(resolveClientPageGraph({ ...input, plugins: [left] }))).reason,
		).toEqual({ code: "dependency-unavailable", reference: dependencyReference("cycle-right") });
	}),
);

it.effect("rejects missing imported exports and targets absent from the importing alias map", () =>
	Effect.gen(function* () {
		const pageExport = {
			kind: "page" as const,
			entry: "client/page.tsx",
			settingsSchema: { fields: {} },
			automaticEntityPresentations: false,
		};
		const target = plugin("import-target", { exports: {}, apiVersion: 1, homeView: null });
		const importer = {
			...plugin("importer", {
				apiVersion: 1,
				homeView: null,
				exports: { main: pageExport },
				pluginDependencies: { whiskey: dependencyReference("import-target") },
			}),
			clientImports: [{ exportName: "missing", reference: dependencyReference("import-target") }],
		};
		const input = {
			plugin: importer,
			exportName: "main",
			plugins: [importer, target],
			application: "page" as const,
			runtimeArtifactHash: "runtime",
		};
		expect((yield* Effect.flip(resolveClientPageGraph(input))).reason).toEqual({
			code: "export-not-found",
			exportName: pluginExportSpecifier(target, "missing"),
		});
		const undeclared = {
			...importer,
			manifest: {
				...importer.manifest,
				client: {
					...importer.manifest.client,
					homeView: null,
					apiVersion: 1 as const,
					pluginDependencies: {},
					exports: { main: pageExport },
				},
			},
		};
		expect(
			(yield* Effect.flip(
				resolveClientPageGraph({ ...input, plugin: undeclared, plugins: [undeclared, target] }),
			)).reason,
		).toEqual({
			importer: importer.id,
			code: "dependency-undeclared",
			reference: dependencyReference("import-target"),
		});
	}),
);
