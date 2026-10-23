import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { pluginExportSpecifier } from "@ryot-app/plugin-client-contract";
import { Effect } from "effect";

import { fixtureManifest, testPluginPackageId } from "#modules/plugins/test-support";

import { composeClientPage } from "./composition";
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
		const graph = yield* resolveClientPageGraph({
			plugin: page,
			plugins: [page],
			exportName: "a_b",
			application: "page",
			runtimeArtifactHash: "runtime",
		});
		const manifest = composeClientPage({
			identity: graph.identity,
			runtimeEntries: { bootstrap: "bootstrap.js" },
			artifacts: new Map([
				["runtime", { files: [{ name: "bootstrap.js", contentType: "text/javascript" }] }],
				["page-hash", { files: [{ name: "module.js", contentType: "text/javascript" }] }],
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
		expect(graph.identity.selectedExports).toContain(
			pluginExportSpecifier(leftDependency, "common"),
		);
		expect(graph.identity.selectedExports).toContain(
			pluginExportSpecifier(rightDependency, "common"),
		);
		expect(graph.identity.selectedExports).toContain(pluginExportSpecifier(left, "main"));
		expect(graph.identity.selectedExports).toContain(pluginExportSpecifier(right, "main"));
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
