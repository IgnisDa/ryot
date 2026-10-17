import { expect, it } from "@effect/vitest";
import { pluginPackageKey } from "@ryot-app/contract/modules/plugins/references";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { document, field, literal, pluginId, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import { testPluginPackageId } from "#modules/plugins/test-support";

import {
	exportQueryPluginReferences,
	importQueryPluginReferences,
	exportRendererSettings,
	importRendererSettings,
	redactSchemaSecrets,
} from "./references";

it.effect(
	"round-trips typed private query owners without rewriting matching literals or literal objects",
	() =>
		Effect.gen(function* () {
			const packageId = testPluginPackageId();
			const sourceId = PluginId.make("source-owner");
			const destinationId = PluginId.make("destination-unavailable-private-owner");
			const reference = { pluginId: sourceId, kind: "local" as const };
			const value = document({
				records: rows(table("entity", "e"), {
					fields: [
						field("owner", pluginId(reference)),
						field("text", literal(sourceId)),
						field("json", literal({ reference, type: "pluginId" })),
					],
				}),
			});
			const exported = yield* exportQueryPluginReferences(
				value,
				new Map([[sourceId, { packageId, scope: "user" }]]),
			);
			const restored = yield* importQueryPluginReferences(
				exported,
				new Map([[pluginPackageKey({ packageId, scope: "user" }), destinationId]]),
			);
			expect(restored?.queries["records"]?.output).toMatchObject({
				fields: [
					{ expr: { type: "pluginId", reference: { kind: "local", pluginId: destinationId } } },
					{ expr: { type: "literal", value: sourceId } },
					{ expr: { type: "literal", value: { reference, type: "pluginId" } } },
				],
			});
			const wrongScope = yield* importQueryPluginReferences(
				exported,
				new Map([[pluginPackageKey({ packageId, scope: "system" }), destinationId]]),
			).pipe(Effect.flip);
			expect(wrongScope.reason).toBe("missing_reference_mapping");
		}),
);

it.effect("rewrites the known renderer schema reference but preserves opaque plugin settings", () =>
	Effect.gen(function* () {
		const packageId = testPluginPackageId();
		const key = pluginPackageKey({ packageId, scope: "user" });
		const settings = {
			pageSize: 50,
			sortChoices: [],
			searchFields: [],
			layouts: ["grid"],
			tableColumns: null,
			sourceName: "records",
			defaultLayout: "grid",
			subject: {
				entityAlias: "entity",
				schemas: [
					{ slug: "bottle", owner: { kind: "plugin", pluginId: "source-owner" } },
					{ slug: "collection", owner: { kind: "kernel" } },
				],
			},
			addAction: {
				type: "provider-search",
				schema: { slug: "bottle", owner: { kind: "plugin", pluginId: "source-owner" } },
				library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
			},
		};
		const renderer = { kind: "kernel", name: "entity-browser" };
		const exported = yield* exportRendererSettings(
			renderer,
			settings,
			new Map([["source-owner", key]]),
		);
		expect(exported["addAction"]).toEqual({
			type: "provider-search",
			schema: { pluginKey: key, slug: "bottle" },
			library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
		});
		expect(exported["subject"]).toEqual({
			entityAlias: "entity",
			schemas: [
				{ pluginKey: key, slug: "bottle" },
				{ pluginKey: null, slug: "collection" },
			],
		});
		const unmapped = yield* exportRendererSettings(renderer, settings, new Map()).pipe(Effect.flip);
		expect(unmapped.reason).toBe("missing_reference_mapping");
		const restored = yield* importRendererSettings(
			renderer,
			exported,
			new Map([[key, "destination-owner"]]),
		);
		expect(restored["subject"]).toEqual({
			entityAlias: "entity",
			schemas: [
				{ slug: "bottle", owner: { kind: "plugin", pluginId: "destination-owner" } },
				{ slug: "collection", owner: { kind: "kernel" } },
			],
		});
		expect(restored["addAction"]).toEqual({
			type: "provider-search",
			schema: { slug: "bottle", owner: { kind: "plugin", pluginId: "destination-owner" } },
			library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
		});
		const opaque = { ownerPluginId: "source-owner", addAction: settings.addAction };
		expect(yield* exportRendererSettings({ kind: "plugin" }, opaque, new Map())).toBe(opaque);
		expect(yield* importRendererSettings({ kind: "plugin" }, opaque, new Map())).toBe(opaque);
	}),
);

it.effect("maps plugin-owned relationship filter field owners through the archive", () =>
	Effect.gen(function* () {
		const key = pluginPackageKey({ scope: "user", packageId: testPluginPackageId() });
		const valueField = { key: "name", type: "text", label: "Name", kind: "value", field: "name" };
		const settings = {
			pageSize: 50,
			addAction: null,
			sortChoices: [],
			searchFields: [],
			layouts: ["grid"],
			tableColumns: null,
			sourceName: "records",
			defaultLayout: "grid",
			subject: { entityAlias: "entity", schemas: [{ slug: "bottle", owner: { kind: "kernel" } }] },
			filterFields: [
				valueField,
				{
					key: "tags",
					label: "tags",
					kind: "relationship",
					direction: "incoming",
					relationship: { slug: "tagged", owner: { kind: "plugin", pluginId: "source-owner" } },
				},
				{
					key: "labels",
					label: "labels",
					kind: "relationship",
					direction: "incoming",
					relationship: { slug: "labelled", owner: { kind: "kernel" } },
				},
			],
		};
		const renderer = { kind: "kernel", name: "entity-browser" };
		const exported = yield* exportRendererSettings(
			renderer,
			settings,
			new Map([["source-owner", key]]),
		);
		expect(exported["filterFields"]).toEqual([
			valueField,
			{
				key: "tags",
				label: "tags",
				kind: "relationship",
				direction: "incoming",
				relationship: { pluginKey: key, slug: "tagged" },
			},
			{
				key: "labels",
				label: "labels",
				kind: "relationship",
				direction: "incoming",
				relationship: { pluginKey: null, slug: "labelled" },
			},
		]);
		const unmapped = yield* exportRendererSettings(renderer, settings, new Map()).pipe(Effect.flip);
		expect(unmapped.reason).toBe("missing_reference_mapping");
		const restored = yield* importRendererSettings(
			renderer,
			exported,
			new Map([[key, "destination-owner"]]),
		);
		expect(restored["filterFields"]).toEqual([
			valueField,
			{
				key: "tags",
				label: "tags",
				kind: "relationship",
				direction: "incoming",
				relationship: { slug: "tagged", owner: { kind: "plugin", pluginId: "destination-owner" } },
			},
			{
				key: "labels",
				label: "labels",
				kind: "relationship",
				direction: "incoming",
				relationship: { slug: "labelled", owner: { kind: "kernel" } },
			},
		]);
		const missing = yield* importRendererSettings(renderer, exported, new Map()).pipe(Effect.flip);
		expect(missing.reason).toBe("missing_reference_mapping");
	}),
);

it.effect("round-trips plugin-route add actions without remapping their package target", () =>
	Effect.gen(function* () {
		const addAction = {
			path: "/items/item-1",
			search: { tab: "history" },
			type: "plugin-route" as const,
			packageId: PluginPackageId.make("test/target"),
		};
		const settings = {
			addAction,
			pageSize: 50,
			sortChoices: [],
			searchFields: [],
			layouts: ["grid"],
			tableColumns: null,
			sourceName: "records",
			defaultLayout: "grid",
			subject: { entityAlias: "entity", schemas: [{ slug: "bottle", owner: { kind: "kernel" } }] },
		};
		const renderer = { kind: "kernel", name: "entity-browser" };
		const exported = yield* exportRendererSettings(renderer, settings, new Map());
		expect(exported["addAction"]).toEqual(addAction);
		const restored = yield* importRendererSettings(renderer, exported, new Map());
		expect(restored["addAction"]).toEqual(addAction);
	}),
);

it("redacts schema-marked configuration secrets and records pointers", () => {
	const result = redactSchemaSecrets(
		{ token: "secret", unit: "minutes" },
		{
			unknownKeys: "strict",
			fields: {
				unit: { label: "Unit", type: "string", validation: {}, description: "Unit" },
				token: {
					secret: true,
					label: "Token",
					type: "string",
					validation: {},
					description: "Token",
				},
			},
		},
		"/installations/one/config",
	);
	expect(result).toEqual({
		redacted: { unit: "minutes" },
		redactions: ["/installations/one/config/token"],
	});
});

it("drops OAuth connection settings from exported integration settings", () => {
	const result = redactSchemaSecrets(
		{ unit: "minutes", account: "connection-id" },
		{
			fields: {
				unit: { label: "Unit", type: "string", description: "Unit" },
				account: {
					type: "string",
					label: "Account",
					description: "Linked account",
					format: { provider: "account", kind: "oauth-connection" },
				},
			},
		},
		"/integrations/one/providerSpecifics",
	);
	expect(result).toEqual({
		redacted: { unit: "minutes" },
		redactions: ["/integrations/one/providerSpecifics/account"],
	});
});
