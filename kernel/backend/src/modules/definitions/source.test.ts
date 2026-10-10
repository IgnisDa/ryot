import type { AuthoredEntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import {
	EntitySchemaSlug,
	PluginId,
	PluginPackageId,
	RelationshipSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import { column, field, pluginId, rows, table } from "@ryot-app/ryotql";
import { assert, expect, it } from "vitest";

import { fixtureManifest } from "#modules/plugins/test-support";

import { revisionDefinitions } from "./source";

const browserSettings = {
	pageSize: 20,
	addAction: null,
	sortChoices: [],
	layouts: ["grid"],
	tableColumns: null,
	defaultLayout: "grid",
	searchFields: ["name"],
	sourceName: "savedView",
	subject: {
		entityAlias: "entity",
		schemas: [{ owner: { kind: "self" }, slug: EntitySchemaSlug.make("bottle") }],
	},
} satisfies AuthoredEntityBrowserSavedViewSettings;

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
	const pluginView = { ...savedView, dataSources };
	const browserView = {
		dataSources,
		icon: "box",
		sortOrder: 1,
		slug: "bottles",
		name: "Bottles",
		renderer: { kind: "kernel", name: "entity-browser" } as const,
		settings: {
			...browserSettings,
			addAction: {
				type: "provider-search",
				schema: { owner: { kind: "self" }, slug: EntitySchemaSlug.make("bottle") },
				library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
			},
		} satisfies AuthoredEntityBrowserSavedViewSettings,
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
	const browserAction = browserView.settings.addAction;
	expect(views[0]?.settings).toEqual(savedView.settings);
	expect(views[0]?.renderer).toEqual({
		kind: "plugin",
		pluginId: "plugin-a",
		exportName: "summary",
	});
	expect(views[1]?.settings["addAction"]).toEqual({
		type: "provider-search",
		schema: { slug: "bottle", owner: { kind: "plugin", pluginId: "plugin-a" } },
		library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
	});
	expect(views[1]?.settings["subject"]).toEqual({
		entityAlias: "entity",
		schemas: [{ slug: "bottle", owner: { kind: "plugin", pluginId: "plugin-a" } }],
	});
	expect(browserAction.schema.owner).toEqual({ kind: "self" });
});

it("keeps plugin-route add actions portable while materializing saved views", () => {
	const addAction = {
		path: "/items/item-1",
		search: { tab: "history" },
		type: "plugin-route" as const,
		packageId: PluginPackageId.make("target/package"),
	};
	const browserView = {
		icon: "box",
		sortOrder: 0,
		name: "Bottles",
		slug: "bottles",
		dataSources: { queries: {} },
		settings: { ...browserSettings, addAction },
		renderer: { kind: "kernel", name: "entity-browser" } as const,
	};
	const view = revisionDefinitions("plugin-a", {
		...fixtureManifest(),
		client,
		savedViews: [browserView],
	}).savedViews[0];
	assert(view);
	expect(view.settings["addAction"]).toEqual(addAction);
});

it("resolves self relationship owners on filter fields", () => {
	const browserView = {
		icon: "box",
		sortOrder: 0,
		name: "Bottles",
		slug: "bottles",
		dataSources: { queries: {} },
		renderer: { kind: "kernel", name: "entity-browser" } as const,
		settings: {
			...browserSettings,
			filterFields: [
				{ key: "name", type: "text", label: "Name", kind: "value", field: "name" },
				{
					key: "tags",
					label: "Tags",
					kind: "relationship",
					direction: "incoming",
					relationship: { owner: { kind: "self" }, slug: RelationshipSchemaSlug.make("tagged") },
				},
				{
					key: "labels",
					label: "Labels",
					kind: "relationship",
					direction: "outgoing",
					relationship: {
						owner: { kind: "kernel" },
						slug: RelationshipSchemaSlug.make("labelled"),
					},
				},
			],
		} satisfies AuthoredEntityBrowserSavedViewSettings,
	};
	const view = revisionDefinitions("plugin-a", {
		...fixtureManifest(),
		client,
		savedViews: [browserView],
	}).savedViews[0];
	assert(view);
	expect(view.settings["filterFields"]).toEqual([
		browserView.settings.filterFields[0],
		{
			...browserView.settings.filterFields[1],
			relationship: { slug: "tagged", owner: { kind: "plugin", pluginId: "plugin-a" } },
		},
		browserView.settings.filterFields[2],
	]);
});

it("materializes calendar sources with self references bound to the stable plugin id", () => {
	const entity = table("entity", "entity");
	const calendarSource = {
		name: "Dates",
		slug: "dates",
		icon: "calendar",
		startAt: "startAt",
		precision: "date" as const,
		subject: browserSettings.subject,
		query: {
			from: entity,
			output: {
				type: "rows" as const,
				fields: [
					field("startAt", column(entity, "createdAt")),
					field("owner", pluginId({ kind: "self" })),
				],
			},
		},
	};

	expect(revisionDefinitions("plugin-a", fixtureManifest()).calendarSources).toEqual([]);
	expect(
		revisionDefinitions("plugin-a", { ...fixtureManifest(), calendarSources: [calendarSource] })
			.calendarSources,
	).toEqual([
		{
			art: null,
			done: null,
			name: "Dates",
			slug: "dates",
			caption: null,
			icon: "calendar",
			precision: "date",
			startAt: "startAt",
			pluginId: "plugin-a",
			subject: {
				entityAlias: "entity",
				schemas: [{ slug: "bottle", owner: { kind: "plugin", pluginId: "plugin-a" } }],
			},
			query: {
				from: entity,
				output: {
					type: "rows",
					fields: [
						field("startAt", column(entity, "createdAt")),
						field("owner", pluginId({ kind: "local", pluginId: PluginId.make("plugin-a") })),
					],
				},
			},
		},
	]);
});
