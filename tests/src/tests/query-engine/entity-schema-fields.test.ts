import { Effect } from "effect";

import {
	buildEntityRowsQueryDocument,
	createAuthenticatedClient,
	createQueryEngineEntity,
	createQueryEngineTrackerAndSchema,
	executeQueryEngine,
	postBackendJson,
	requireQueryEngineFieldValue,
	schemaMetaRef,
	systemRef,
} from "~/fixtures";
import { assertPresent, requireObjectRecord, requireString } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const expectQueryDecodeBadRequest = (body: unknown, cookies: string) =>
	Effect.gen(function* () {
		const response = yield* Effect.promise(() =>
			postBackendJson("/query-engine/execute", body, cookies),
		);
		const error = requireObjectRecord(
			yield* Effect.promise(() => response.json()),
			"Expected BadRequest response",
		);

		expect(response.status).toBe(400);
		expect(requireString(error._tag, "Expected error tag")).toBe("BadRequest");
	});

describe("entity schema fields", () => {
	it.live("returns entity schema slug, name, and isBuiltin fields", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "SchemaFieldsItem",
			});
			yield* createQueryEngineEntity(client, {
				name: "Schema Fields Entity",
				entitySchemaId: schemaId,
			});

			const result = yield* executeQueryEngine(
				client,
				buildEntityRowsQueryDocument({
					alias: "item",
					schemas: [slug],
					fields: [
						{ key: "schemaSlug", expr: schemaMetaRef("item", "slug") },
						{ key: "schemaName", expr: schemaMetaRef("item", "name") },
						{ key: "schemaIsBuiltin", expr: schemaMetaRef("item", "isBuiltin") },
					],
				}),
			);

			const item = result.data.items[0];
			assertPresent(item, "Missing schema fields row");
			expect(requireQueryEngineFieldValue(item, "schemaSlug").value).toBe(slug);
			expect(requireQueryEngineFieldValue(item, "schemaName").value).toBe("SchemaFieldsItem");
			expect(requireQueryEngineFieldValue(item, "schemaIsBuiltin")).toEqual({
				kind: "boolean",
				value: false,
			});
		}),
	);

	it.live("can filter by entity schema slug", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const alpha = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "AlphaFilterItem",
			});
			const beta = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "BetaFilterItem",
			});
			yield* createQueryEngineEntity(client, {
				name: "Alpha Entity",
				entitySchemaId: alpha.schemaId,
			});
			yield* createQueryEngineEntity(client, {
				name: "Beta Entity",
				entitySchemaId: beta.schemaId,
			});

			const result = yield* executeQueryEngine(
				client,
				buildEntityRowsQueryDocument({
					alias: "item",
					schemas: [alpha.slug, beta.slug],
					fields: [{ key: "name", expr: systemRef("item", "name") }],
					where: {
						left: schemaMetaRef("item", "slug"),
						right: { type: "literal", value: alpha.slug },
						type: "comparison",
						operator: "eq",
					},
				}),
			);

			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Missing filtered row");
			expect(requireQueryEngineFieldValue(item, "name").value).toBe("Alpha Entity");
		}),
	);

	it.live("sorts multi-schema rows by entity schema name", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const zebra = yield* createQueryEngineTrackerAndSchema(client, { schemaName: "ZebraSchema" });
			const alpha = yield* createQueryEngineTrackerAndSchema(client, { schemaName: "AlphaSchema" });
			yield* createQueryEngineEntity(client, {
				name: "Zebra Entity",
				entitySchemaId: zebra.schemaId,
			});
			yield* createQueryEngineEntity(client, {
				name: "Alpha Entity",
				entitySchemaId: alpha.schemaId,
			});

			const result = yield* executeQueryEngine(
				client,
				buildEntityRowsQueryDocument({
					alias: "item",
					schemas: [zebra.slug, alpha.slug],
					fields: [{ key: "schemaName", expr: schemaMetaRef("item", "name") }],
					orderBy: [{ order: "asc", expr: schemaMetaRef("item", "name") }],
				}),
			);

			expect(
				result.data.items.map((item) => requireQueryEngineFieldValue(item, "schemaName").value),
			).toEqual(["AlphaSchema", "ZebraSchema"]);
		}),
	);

	it.live("rejects invalid entity schema columns", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const { slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "InvalidSchemaColItem",
			});
			const invalidSchemaField = JSON.parse(
				'{"type":"ref","sourceAlias":"item","field":{"type":"schema","name":"propertiesSchema"}}',
			);

			yield* expectQueryDecodeBadRequest(
				buildEntityRowsQueryDocument({
					alias: "item",
					schemas: [slug],
					fields: [{ key: "bad", expr: invalidSchemaField }],
				}),
				cookies,
			);
		}),
	);

	it.live("rejects entity builtins masquerading as entity-schema columns", () =>
		Effect.gen(function* () {
			const { client, cookies } = yield* createAuthenticatedClient();
			const { slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "MasqueradeItem",
			});
			const masqueradeField = JSON.parse(
				'{"type":"ref","sourceAlias":"item","field":{"type":"schema","name":"externalId"}}',
			);

			yield* expectQueryDecodeBadRequest(
				buildEntityRowsQueryDocument({
					alias: "item",
					schemas: [slug],
					fields: [{ key: "bad", expr: masqueradeField }],
				}),
				cookies,
			);
		}),
	);
});
