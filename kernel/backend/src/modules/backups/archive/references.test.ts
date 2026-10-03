import { expect, it } from "@effect/vitest";
import { pluginPackageKey } from "@ryot-app/contract/modules/plugins/references";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { document, field, literal, pluginId, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

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
			const packageId = PluginPackageId.make(crypto.randomUUID());
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
				null,
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
				null,
			).pipe(Effect.flip);
			expect(wrongScope.reason).toBe("missing_reference_mapping");
		}),
);

it.effect("rewrites the known renderer schema reference but preserves opaque plugin settings", () =>
	Effect.gen(function* () {
		const packageId = PluginPackageId.make(crypto.randomUUID());
		const key = pluginPackageKey({ packageId, scope: "user" });
		const settings = {
			pageSize: 50,
			sortChoices: [],
			searchFields: [],
			layouts: ["grid"],
			tableColumns: null,
			entityIdField: "id",
			sourceName: "records",
			defaultLayout: "grid",
			ownerPluginIdField: "owner",
			entitySchemaSlugField: "schema",
			addAction: {
				type: "provider-search",
				schema: { slug: "bottle", owner: { kind: "plugin", pluginId: "source-owner" } },
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
		});
		const restored = yield* importRendererSettings(
			renderer,
			exported,
			new Map([[key, "destination-owner"]]),
		);
		expect(restored["addAction"]).toEqual({
			type: "provider-search",
			schema: { slug: "bottle", owner: { kind: "plugin", pluginId: "destination-owner" } },
		});
		const opaque = { ownerPluginId: "source-owner", addAction: settings.addAction };
		expect(yield* exportRendererSettings({ kind: "plugin" }, opaque, new Map())).toBe(opaque);
		expect(yield* importRendererSettings({ kind: "plugin" }, opaque, new Map())).toBe(opaque);
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
