import { describe, expect, it } from "vitest";

import { buildQueryEngineEntityRowsDocument } from "./documents";
import { queryEngineField, queryEngineSystemRef } from "./primitives";
import {
	buildAllCollectionsQueryDocument,
	buildEntityDetailQueryDocument,
	buildEntityInterestQueryDocument,
} from "./recipes/app";

describe("query-engine builders", () => {
	it("defaults entity rows to the identity contract and saved-view pagination", () => {
		expect(buildQueryEngineEntityRowsDocument({ schemas: ["book"] })).toEqual({
			source: { type: "entities", alias: "entity", schemas: ["book"], where: null },
			output: {
				type: "rows",
				pagination: { page: 1, limit: 20 },
				orderBy: [{ order: "asc", expr: queryEngineSystemRef("entity", "name") }],
				fields: [
					queryEngineField("id", queryEngineSystemRef("entity", "id")),
					queryEngineField("name", queryEngineSystemRef("entity", "name")),
					{
						key: "schemaSlug",
						expr: { type: "ref", sourceAlias: "entity", field: { type: "schema", name: "slug" } },
					},
				],
			},
		});
	});

	it("builds the collections recipe with default and requested pagination", () => {
		expect(buildAllCollectionsQueryDocument({})).toEqual({
			source: { type: "entities", alias: "entity", schemas: ["collection"], where: null },
			output: {
				type: "rows",
				pagination: { page: 1, limit: 20 },
				orderBy: [{ order: "asc", expr: queryEngineSystemRef("entity", "name") }],
				fields: [
					queryEngineField("id", queryEngineSystemRef("entity", "id")),
					queryEngineField("name", queryEngineSystemRef("entity", "name")),
					{
						key: "schemaSlug",
						expr: { type: "ref", sourceAlias: "entity", field: { type: "schema", name: "slug" } },
					},
				],
			},
		});
		expect(buildAllCollectionsQueryDocument({ page: 3, limit: 7 }).output.pagination).toEqual({
			page: 3,
			limit: 7,
		});
	});

	it("projects entity detail provenance from the provider", () => {
		const document = buildEntityDetailQueryDocument({
			entityId: "entity-id",
			entitySchemaSlug: "book",
		});

		expect(document.output.fields).toContainEqual(
			queryEngineField("providerId", queryEngineSystemRef("entity", "providerId")),
		);
		expect(document.output.fields.map((field) => field.key)).not.toContain("sandboxScriptId");
	});

	it("projects entity interest provenance from the provider", () => {
		const document = buildEntityInterestQueryDocument({
			entityIds: ["entity-id"],
			entitySchemaSlugs: ["book"],
		});

		expect(document.output.fields).toContainEqual(
			queryEngineField("providerId", queryEngineSystemRef("entity", "providerId")),
		);
		expect(document.output.fields.map((field) => field.key)).not.toContain("sandboxScriptId");
	});
});
