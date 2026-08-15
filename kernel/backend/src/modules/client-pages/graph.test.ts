import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Effect } from "effect";

import { fixtureManifest } from "#modules/plugins/test-support";

import { composeClientPage } from "./composition";
import type { GraphPlugin } from "./graph";
import { resolveClientPageGraph } from "./graph";

const plugin = (slug: string, client: NonNullable<PluginManifest["client"]>): GraphPlugin => {
	const manifest = fixtureManifest();
	return {
		slug,
		health: "ready",
		id: `${slug}-id`,
		isDisabled: false,
		sourceHash: `${slug}-source`,
		clientArtifactHash: `${slug}-hash`,
		manifest: { ...manifest, client, metadata: { ...manifest.metadata, slug } },
	};
};

it.effect("keeps eager dependencies separate from presentation-only transitive artifacts", () => {
	const dependency = plugin("dependency", { exports: {}, apiVersion: 1, homeView: null });
	const presentation = plugin("presentation", {
		apiVersion: 1,
		homeView: null,
		pluginDependencies: ["dependency"],
		entities: { entity: { gridPresentation: "card" } },
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
		pluginDependencies: ["dependency"],
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

it.effect("matches the compiler's export binding order for punctuation in names", () => {
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
				binding: "Export1",
				specifier: "@ryot-app/plugins/page/a_b",
			});
		}
	});
});
