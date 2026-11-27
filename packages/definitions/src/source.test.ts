import { expect, it } from "bun:test";

import type { AuthoredEntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import {
	EntitySchemaSlug,
	PluginId,
	PluginPackageId,
	RelationshipSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import { fixtureManifest } from "@ryot-app/contract/testing";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { column, document, field, pluginId, rows, table } from "@ryot-app/ryotql";
import { assert } from "@ryot-app/testing/assert";

import { revisionDefinitions } from "./source";

const browserSettings = {
	pageSize: 20,
	addAction: null,
	layouts: ["grid"],
	tableColumns: null,
	defaultLayout: "grid",
	sourceName: "savedView",
	summary: { image: null, subtitle: null },
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
						type: "string" as const,
						label: { key: "test.title" },
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
	slug: "summary",
	dataSources: null,
	name: { key: "test.summary" },
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
		name: { key: "test.csv" },
		requiredPluginConfigKeys: [],
		workflowSlug: "fixture-flow",
		description: { key: "test.csv-import" },
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
		name: { key: "test.bottles" },
		renderer: { kind: "kernel", name: "entity-browser" } as const,
		settings: {
			...browserSettings,
			addAction: {
				type: "provider-search",
				schema: { owner: { kind: "self" }, slug: EntitySchemaSlug.make("bottle") },
				library: {
					librarySchemaSlug: "media-library",
					relationshipSlug: "in-media-library",
					entryEvent: { eventSchemaSlug: "planned", label: { key: "test.plan" } },
				},
			},
		} satisfies AuthoredEntityBrowserSavedViewSettings,
	};
	const views = revisionDefinitions("plugin-a", {
		...fixtureManifest(),
		client,
		savedViews: [pluginView, browserView],
	}).savedViews;
	for (const view of views) {
		if (view.renderer.kind === "kernel") {
			expect(view.dataSources?.queries["savedView"]?.where).toBeDefined();
		} else {
			expect(view.dataSources?.queries["savedView"]?.where).toBeUndefined();
		}
		const output = view.dataSources?.queries["savedView"]?.output;
		assert(output?.type === "rows");
		expect(output.fields[0]).toMatchObject({
			expr: { type: "column", field: "entitySchemaPluginId" },
		});
		expect(output.fields[1]).toMatchObject({
			expr: { type: "pluginId", reference: { kind: "local", pluginId: "plugin-a" } },
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
		library: {
			librarySchemaSlug: "media-library",
			relationshipSlug: "in-media-library",
			entryEvent: {
				eventSchemaSlug: "planned",
				label: { key: "test.plan", namespace: "plugin-a" },
			},
		},
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
		slug: "bottles",
		name: { key: "test.bottles" },
		settings: { ...browserSettings, addAction },
		renderer: { kind: "kernel", name: "entity-browser" } as const,
		dataSources: document({ savedView: rows(table("entity", "entity"), { fields: [] }) }),
	};
	const view = revisionDefinitions("plugin-a", {
		...fixtureManifest(),
		client,
		savedViews: [browserView],
	}).savedViews[0];
	assert(view);
	expect(view.settings["addAction"]).toEqual(addAction);
});

it("stamps saved-view data source parameter text with the plugin namespace", () => {
	const view = revisionDefinitions("plugin-a", {
		...fixtureManifest(),
		client,
		savedViews: [
			{
				...savedView,
				dataSources: {
					...document({ savedView: rows(table("entity", "entity"), { fields: [] }) }),
					parameters: {
						fields: {
							search: { type: "string", description: "Search", label: { key: "test.search" } },
						},
					},
				},
			},
		],
	}).savedViews[0];
	assert(view);
	expect(view.dataSources?.parameters?.fields["search"]?.label).toEqual({
		key: "test.search",
		namespace: "plugin-a",
	});
});

const stamped = (key: string) => ({ key: `test.${key}`, namespace: "plugin-a" });

it("resolves self owners and plugin references in entity schema browse fields", () => {
	const manifest = fixtureManifest();
	const [entitySchema] = manifest.entitySchemas;
	assert(entitySchema);
	const tags = {
		key: "tags",
		kind: "relationship",
		direction: "incoming",
		label: { key: "test.tags" },
		relationship: { owner: { kind: "self" }, slug: RelationshipSchemaSlug.make("tagged") },
	} as const;
	const labels = {
		key: "labels",
		kind: "relationship",
		direction: "outgoing",
		label: { key: "test.labels" },
		relationship: { owner: { kind: "kernel" }, slug: RelationshipSchemaSlug.make("labelled") },
	} as const;
	const owned = {
		key: "owned",
		kind: "value",
		type: "boolean",
		label: { key: "test.owned" },
		expression: { type: "isNotNull", expr: pluginId({ kind: "self" }) },
	} as const;
	const [materialized] = revisionDefinitions("plugin-a", {
		...manifest,
		entitySchemas: [{ ...entitySchema, browse: { fields: [owned, tags, labels] } }],
	}).entitySchemas;
	expect(materialized?.browse).toEqual<unknown>({
		fields: [
			{
				...owned,
				label: stamped("owned"),
				expression: {
					type: "isNotNull",
					expr: pluginId({ kind: "local", pluginId: PluginId.make("plugin-a") }),
				},
			},
			{
				...tags,
				label: stamped("tags"),
				relationship: { slug: "tagged", owner: { kind: "plugin", pluginId: "plugin-a" } },
			},
			{ ...labels, label: stamped("labels") },
		],
	});
});

it("stamps property text with the plugin namespace and keeps kernel messages", () => {
	const manifest = fixtureManifest();
	const [entitySchema] = manifest.entitySchemas;
	assert(entitySchema);
	const item = kernelMessage("definition.property.item");
	const [materialized] = revisionDefinitions("plugin-a", {
		...manifest,
		entitySchemas: [
			{
				...entitySchema,
				propertiesSchema: {
					fields: {
						tags: {
							label: item,
							type: "array",
							description: "Tags",
							items: { type: "string", description: "Tag", label: { key: "test.tag" } },
						},
						kind: {
							type: "enum",
							description: "Kind",
							label: { key: "test.kind" },
							hint: { key: "test.kind-hint" },
							choices: {
								kind: "static",
								values: [{ value: "one", label: { key: "test.one" } }, { value: "two" }],
							},
						},
					},
				},
			},
		],
	}).entitySchemas;
	expect(materialized?.propertiesSchema.fields).toEqual({
		tags: {
			label: item,
			type: "array",
			description: "Tags",
			items: { type: "string", description: "Tag", label: stamped("tag") },
		},
		kind: {
			type: "enum",
			description: "Kind",
			label: stamped("kind"),
			hint: stamped("kind-hint"),
			choices: {
				kind: "static",
				values: [{ value: "one", label: stamped("one") }, { value: "two" }],
			},
		},
	});
});

it("materializes calendar sources with self references bound to the stable plugin id", () => {
	const entity = table("entity", "entity");
	const calendarSource = {
		slug: "dates",
		icon: "calendar",
		startAt: "startAt",
		precision: "date" as const,
		name: { key: "test.dates" },
		subject: browserSettings.subject,
		caption: { params: { owner: "owner" }, text: { key: "test.dates.caption" } },
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
	).toEqual<unknown>([
		{
			art: null,
			done: null,
			slug: "dates",
			icon: "calendar",
			precision: "date",
			startAt: "startAt",
			pluginId: "plugin-a",
			name: { key: "test.dates" },
			caption: {
				params: { owner: "owner" },
				text: { namespace: "plugin-a", key: "test.dates.caption" },
			},
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
