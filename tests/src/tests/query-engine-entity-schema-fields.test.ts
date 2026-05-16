import { describe, expect, it } from "bun:test";

import {
	buildEntityRowsQueryDocument,
	createAuthenticatedClient,
	createQueryEngineEntity,
	createQueryEngineTrackerAndSchema,
	executeQueryEngine,
	executeQueryEngineError,
	requireQueryEngineFieldValue,
	schemaMetaRef,
	systemRef,
} from "../fixtures";
import { assertPresent, assertTaggedError } from "../test-support/assertions";

describe("entity schema fields", () => {
	it("returns entity schema slug, name, and isBuiltin fields", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "SchemaFieldsItem",
		});
		await createQueryEngineEntity(client, {
			name: "Schema Fields Entity",
			entitySchemaId: schemaId,
		});

		const result = await executeQueryEngine(
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
	});

	it("can filter by entity schema slug", async () => {
		const { client } = await createAuthenticatedClient();
		const alpha = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "AlphaFilterItem",
		});
		const beta = await createQueryEngineTrackerAndSchema(client, { schemaName: "BetaFilterItem" });
		await createQueryEngineEntity(client, { name: "Alpha Entity", entitySchemaId: alpha.schemaId });
		await createQueryEngineEntity(client, { name: "Beta Entity", entitySchemaId: beta.schemaId });

		const result = await executeQueryEngine(
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
	});

	it("sorts multi-schema rows by entity schema name", async () => {
		const { client } = await createAuthenticatedClient();
		const zebra = await createQueryEngineTrackerAndSchema(client, { schemaName: "ZebraSchema" });
		const alpha = await createQueryEngineTrackerAndSchema(client, { schemaName: "AlphaSchema" });
		await createQueryEngineEntity(client, { name: "Zebra Entity", entitySchemaId: zebra.schemaId });
		await createQueryEngineEntity(client, { name: "Alpha Entity", entitySchemaId: alpha.schemaId });

		const result = await executeQueryEngine(
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
	});

	it("rejects invalid entity schema columns", async () => {
		const { client } = await createAuthenticatedClient();
		const { slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "InvalidSchemaColItem",
		});
		const invalidSchemaField = JSON.parse(
			'{"type":"ref","sourceAlias":"item","field":{"type":"schema","name":"propertiesSchema"}}',
		);

		const error = await executeQueryEngineError(
			client,
			buildEntityRowsQueryDocument({
				alias: "item",
				schemas: [slug],
				fields: [{ key: "bad", expr: invalidSchemaField }],
			}),
		);

		assertTaggedError(error, "ParseError");
	});

	it("rejects entity builtins masquerading as entity-schema columns", async () => {
		const { client } = await createAuthenticatedClient();
		const { slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "MasqueradeItem",
		});
		const masqueradeField = JSON.parse(
			'{"type":"ref","sourceAlias":"item","field":{"type":"schema","name":"externalId"}}',
		);

		const error = await executeQueryEngineError(
			client,
			buildEntityRowsQueryDocument({
				alias: "item",
				schemas: [slug],
				fields: [{ key: "bad", expr: masqueradeField }],
			}),
		);

		assertTaggedError(error, "ParseError");
	});
});
