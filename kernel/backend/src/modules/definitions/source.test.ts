import { column, field, pluginId, rows, table } from "@ryot-app/ryotql";
import { assert, expect, it } from "vitest";

import { fixtureManifest } from "#modules/plugins/test-support";

import { kernelDefinitionSource } from "./kernel-source";
import { revisionDefinitions } from "./source";

const client = {
	homeView: "summary",
	apiVersion: 1 as const,
	exports: {
		summary: {
			kind: "page" as const,
			entry: "client/summary.tsx",
			automaticEntityPresentations: false,
			settingsSchema: {
				unknownKeys: "strict" as const,
				fields: {
					title: {
						label: "Title",
						type: "string" as const,
						description: "Summary title",
						validation: { required: true as const },
					},
				},
			},
		},
	},
};

const savedView = {
	icon: "box",
	sortOrder: 0,
	name: "Summary",
	slug: "summary",
	dataSources: null,
	settings: { title: "Fixture" },
	renderer: { exportName: "summary", kind: "plugin" as const },
};

it("materializes portable saved-view page exports to stable plugin ids", () => {
	const manifest = { ...fixtureManifest(), client, savedViews: [savedView] };

	expect(revisionDefinitions("fixture-plugin-id", manifest).savedViews[0]).toMatchObject({
		pluginId: "fixture-plugin-id",
		renderer: { kind: "plugin", exportName: "summary", pluginId: "fixture-plugin-id" },
	});
	expect(() =>
		revisionDefinitions("fixture-plugin-id", {
			...manifest,
			savedViews: [{ ...savedView, settings: {} }],
		}),
	).toThrow(/Invalid saved view summary/);
});

it("resolves import source workflow scripts from the revision workflows", () => {
	const importSource = {
		slug: "csv",
		name: "CSV",
		description: "CSV import",
		requiredPluginConfigKeys: [],
		workflowSlug: "fixture-flow",
		inputSchema: { fields: {}, unknownKeys: "strict" as const },
	};
	const manifest = {
		...fixtureManifest(),
		workflows: [{ slug: "fixture-flow", scriptSlug: "fixture.workflow" }],
		importSources: [importSource, { ...importSource, slug: "orphan", workflowSlug: "missing" }],
	};

	expect(
		revisionDefinitions("fixture-plugin-id", manifest).importSources.map(
			({ slug, workflowScriptSlug }) => [slug, workflowScriptSlug],
		),
	).toEqual([
		["csv", "fixture.workflow"],
		["orphan", null],
	]);
});

it("materializes self expressions uniformly and binds only typed renderer settings", () => {
	const entity = table("entity", "entity");
	const dataSources = {
		queries: {
			savedView: rows(entity, {
				fields: [
					field("ownerPluginId", column(entity, "entitySchemaPluginId")),
					field("owner", pluginId({ kind: "self" })),
				],
			}),
		},
	};
	const kernelView = kernelDefinitionSource().savedViews[0];
	assert(kernelView);
	const pluginView = { ...savedView, dataSources };
	const browserView = {
		...kernelView,
		dataSources,
		slug: "bottles",
		renderer: { kind: "kernel", name: "entity-browser" } as const,
		settings: {
			...kernelView.settings,
			addAction: { type: "provider-search", schema: { slug: "bottle", owner: { kind: "self" } } },
		},
	};
	const views = revisionDefinitions("plugin-a", {
		...fixtureManifest(),
		client,
		savedViews: [pluginView, browserView],
	}).savedViews;
	for (const view of views) {
		expect(view.dataSources?.queries["savedView"]?.where).toBeUndefined();
		expect(view.dataSources?.queries["savedView"]?.output).toMatchObject({
			fields: [
				{ expr: { type: "column", field: "entitySchemaPluginId" } },
				{ expr: { type: "pluginId", reference: { kind: "local", pluginId: "plugin-a" } } },
			],
		});
	}
	expect(views[0]?.settings).toEqual(savedView.settings);
	expect(views[0]?.renderer).toEqual({
		kind: "plugin",
		pluginId: "plugin-a",
		exportName: "summary",
	});
	expect(views[1]?.settings["addAction"]).toEqual({
		type: "provider-search",
		schema: { slug: "bottle", owner: { kind: "plugin", pluginId: "plugin-a" } },
	});
	expect(browserView.settings.addAction.schema.owner).toEqual({ kind: "self" });
});
