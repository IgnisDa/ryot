import { describe, expect, it } from "bun:test";

import {
	buildCollectionMediaSuggestionsQueryDocument,
	buildDefaultSavedViewQueryDocument,
	buildQueryEngineEntityRowsDocument,
	buildShowDetailQueryDocument,
	buildWorkoutTemplateDetailQueryDocument,
	queryEngineField,
	queryEngineSystemRef,
} from "./index";

describe("query-engine builders", () => {
	it("defaults entity rows to the identity contract and saved-view pagination", () => {
		expect(buildQueryEngineEntityRowsDocument({ schemas: ["book"] })).toEqual({
			source: { type: "entities", alias: "entity", schemas: ["book"], where: null },
			output: {
				type: "rows",
				pagination: { page: 1, limit: 20 },
				fields: [
					queryEngineField("id", queryEngineSystemRef("entity", "id")),
					queryEngineField("name", queryEngineSystemRef("entity", "name")),
					{
						key: "schemaSlug",
						expr: {
							type: "ref",
							sourceAlias: "entity",
							field: { type: "schema", name: "slug" },
						},
					},
				],
				orderBy: [{ order: "asc", expr: queryEngineSystemRef("entity", "name") }],
			},
		});
	});

	it("builds show details with caller-owned nested limits", () => {
		const doc = buildShowDetailQueryDocument({
			entityId: "show-id",
			seasonLimit: 4,
			episodeLimit: 12,
		});
		const seasons = doc.output.include?.[0];
		const episodes = seasons && "include" in seasons ? seasons.include[0] : undefined;

		expect(doc.source.where).toMatchObject({
			type: "comparison",
			operator: "eq",
		});
		expect(seasons).toMatchObject({ key: "seasons", limit: 4 });
		expect(episodes).toMatchObject({ key: "episodes", limit: 12 });
	});

	it("uses identity fields for media recommendation groups", () => {
		const doc = buildCollectionMediaSuggestionsQueryDocument({
			collectionId: "collection-id",
			entitySchemaSlug: "book",
		});

		expect(doc.output.groupBy?.map((field) => field.key)).toEqual(["id", "name", "schemaSlug"]);
		expect(doc.output.measures[0]).toMatchObject({ key: "recommendingSourceCount" });
	});

	it("uses the plural workouts include for template detail", () => {
		const doc = buildWorkoutTemplateDetailQueryDocument({
			entityId: "template-id",
			workoutLimit: 6,
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
});
