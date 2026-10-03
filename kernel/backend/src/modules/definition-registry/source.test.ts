import { expect, it } from "vitest";

import { fixtureManifest } from "#modules/plugins/test-support";

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
	pluginSlug: "fixture",
	settings: { title: "Fixture" },
	renderer: { exportName: "summary", kind: "plugin" as const },
};

it("materializes portable saved-view page exports to stable plugin ids", () => {
	const manifest = { ...fixtureManifest(), client, savedViews: [savedView] };

	expect(revisionDefinitions("fixture-plugin-id", "fixture", manifest).savedViews[0]).toMatchObject(
		{
			pluginSlug: "fixture",
			pluginId: "fixture-plugin-id",
			renderer: { kind: "plugin", exportName: "summary", pluginId: "fixture-plugin-id" },
		},
	);
	expect(() =>
		revisionDefinitions("fixture-plugin-id", "fixture", {
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
		revisionDefinitions("fixture-plugin-id", "fixture", manifest).importSources.map(
			({ slug, workflowScriptSlug }) => [slug, workflowScriptSlug],
		),
	).toEqual([
		["csv", "fixture.workflow"],
		["orphan", null],
	]);
});
