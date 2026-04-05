import { describe, expect, it } from "vitest";

import { buildQueryEngineEntityRowsDocument } from "./documents";
import { queryEngineField, queryEngineSystemRef } from "./primitives";
import {
	buildDefaultSavedViewQueryDocument,
	buildEntityDetailQueryDocument,
	buildEntityInterestQueryDocument,
} from "./recipes/app";
import { buildWorkoutTemplateDetailQueryDocument } from "./recipes/fitness";
import {
	buildCollectionMediaSuggestionsQueryDocument,
	buildShowDetailQueryDocument,
} from "./recipes/media";

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

	it("builds show details with caller-owned nested limits", () => {
		const doc = buildShowDetailQueryDocument({
			seasonLimit: 4,
			episodeLimit: 12,
			entityId: "show-id",
		});
		const seasons = doc.output.include?.[0];
		const episodes = seasons && "include" in seasons ? seasons.include[0] : undefined;

		expect(doc.source.where).toMatchObject({ operator: "eq", type: "comparison" });
		expect(seasons).toMatchObject({ key: "seasons", limit: 4 });
		expect(episodes).toMatchObject({ key: "episodes", limit: 12 });
	});

	it("uses identity fields for media recommendation groups", () => {
		const doc = buildCollectionMediaSuggestionsQueryDocument({
			entitySchemaSlug: "book",
			collectionId: "collection-id",
		});

		expect(doc.output.groupBy?.map((field) => field.key)).toEqual(["id", "name", "schemaSlug"]);
		expect(doc.output.measures[0]).toMatchObject({ key: "recommendingSourceCount" });
	});

	it("uses the plural workouts include for template detail", () => {
		const doc = buildWorkoutTemplateDetailQueryDocument({
			workoutLimit: 6,
			entityId: "template-id",
		});

		expect(doc.output.include?.[0]).toMatchObject({ key: "workouts", limit: 6 });
	});

	it("adds the in-library relationship only when requested", () => {
		const document = buildDefaultSavedViewQueryDocument({
			schemas: ["book"],
			requireInLibrary: true,
		});

		expect(document.source.where).toMatchObject({
			type: "exists",
			source: { via: { schema: "in-library" } },
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
