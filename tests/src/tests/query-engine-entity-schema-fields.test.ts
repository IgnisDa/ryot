import { describe, expect, it } from "bun:test";

import {
	createEntityColumnExpression,
	createEntitySchemaExpression,
} from "@ryot/ts-utils/view-language";

import {
	buildQueryEngineField,
	createCrossSchemaQueryEngineFixture,
	createSingleSchemaQueryEngineFixture,
	executeQueryEngine,
	getQueryEngineFieldOrThrow,
	getQueryEngineFieldValue,
	literalExpression,
	toQueryEngineItem,
} from "../fixtures";

describe("entity-schema fields", () => {
	it("returns entity schema slug as a field", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 1 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			fields: [buildQueryEngineField("entitySchemaSlug", createEntitySchemaExpression("slug"))],
		});

		expect(response.status).toBe(200);
		const field = getQueryEngineFieldOrThrow(data.data.items[0], "entitySchemaSlug");
		expect(field.kind).toBe("text");
		expect(field.value).toBe(schema.slug);
	});

	it("returns entity schema name as a field", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 1 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			fields: [buildQueryEngineField("entitySchemaName", createEntitySchemaExpression("name"))],
		});

		expect(response.status).toBe(200);
		expect(data.data.items[0]).toEqual(
			toQueryEngineItem([{ key: "entitySchemaName", kind: "text", value: schema.data.name }]),
		);
	});

	it("returns entity schema isBuiltin as a boolean field", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 1 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			fields: [buildQueryEngineField("isBuiltin", createEntitySchemaExpression("isBuiltin"))],
		});

		expect(response.status).toBe(200);
		expect(data.data.items[0]).toEqual(
			toQueryEngineItem([{ key: "isBuiltin", kind: "boolean", value: false }]),
		);
	});

	it("returns correct entity schema slug per entity in multi-schema queries", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			pagination: { page: 1, limit: 20 },
			scope: [smartphoneSlug, tabletSlug],
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(smartphoneSlug, "name"),
			},
			fields: [buildQueryEngineField("entitySchemaSlug", createEntitySchemaExpression("slug"))],
		});

		expect(response.status).toBe(200);
		const slugs = data.data.items.map((item) => getQueryEngineFieldValue(item, "entitySchemaSlug"));
		expect(slugs.every((slug) => slug === smartphoneSlug || slug === tabletSlug)).toBe(true);
		expect(slugs.some((slug) => slug === smartphoneSlug)).toBe(true);
		expect(slugs.some((slug) => slug === tabletSlug)).toBe(true);
	});

	it("can filter by entity schema slug", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(client, cookies, {
			fields: [],
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 10 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			filter: {
				operator: "eq",
				type: "comparison",
				left: createEntitySchemaExpression("slug"),
				right: literalExpression(schema.slug),
			},
		});

		expect(response.status).toBe(200);
		expect(data.data.items.length).toBeGreaterThan(0);
	});

	it("can sort by entity schema name", async () => {
		const { client, cookies, smartphoneSlug, tabletSlug } =
			await createCrossSchemaQueryEngineFixture();
		const { data, response } = await executeQueryEngine(client, cookies, {
			scope: [smartphoneSlug, tabletSlug],
			eventJoins: [],
			pagination: { page: 1, limit: 20 },
			sort: {
				direction: "asc",
				expression: createEntitySchemaExpression("name"),
			},
			fields: [buildQueryEngineField("entitySchemaName", createEntitySchemaExpression("name"))],
		});

		expect(response.status).toBe(200);
		const names = data.data.items.map((item) => getQueryEngineFieldValue(item, "entitySchemaName"));
		expect(names.length).toBeGreaterThan(1);
	});

	it("rejects invalid entity schema columns", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const { response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 1 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			fields: [buildQueryEngineField("bad", createEntitySchemaExpression("propertiesSchema"))],
		});

		expect(response.status).toBe(400);
	});

	it("rejects entity builtins masquerading as entity-schema columns", async () => {
		const { client, cookies, schema } = await createSingleSchemaQueryEngineFixture();
		const { error, response } = await executeQueryEngine(client, cookies, {
			eventJoins: [],
			scope: [schema.slug],
			pagination: { page: 1, limit: 1 },
			sort: {
				direction: "asc",
				expression: createEntityColumnExpression(schema.slug, "name"),
			},
			fields: [buildQueryEngineField("bad", createEntitySchemaExpression("externalId"))],
		});

		expect(response.status).toBe(400);
		expect(error?.error.message).toBe(
			"Unsupported entity schema column 'entity-schema.externalId'",
		);
	});
});
