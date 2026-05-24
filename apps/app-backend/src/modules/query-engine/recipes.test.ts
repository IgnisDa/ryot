import type { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import {
	buildExerciseListQueryDocument,
	buildMeasurementListQueryDocument,
	buildWorkoutDetailQueryDocument,
	buildWorkoutListQueryDocument,
	buildWorkoutTemplateDetailQueryDocument,
	buildWorkoutTemplateListQueryDocument,
} from "@ryot/fitness-plugin/query-recipes";
import {
	buildCollectionMediaSuggestionsQueryDocument,
	buildCompletedPodcastsQueryDocument,
	buildCompletedShowsQueryDocument,
	buildDefaultMediaSavedViewQueryDocument,
	buildInProgressPodcastsQueryDocument,
	buildInProgressShowsQueryDocument,
	buildPersonalMediaSuggestionsQueryDocument,
	buildPodcastDetailQueryDocument,
	buildShowDetailQueryDocument,
	buildTrendingMediaQueryDocument,
} from "@ryot/media-plugin/query-recipes";
import {
	buildAllCollectionsQueryDocument,
	buildDefaultSavedViewQueryDocument,
	buildEntityDetailQueryDocument,
	buildEntityInterestQueryDocument,
	buildEventHistoryQueryDocument,
} from "@ryot/query-engine/recipes/app";
import { describe, expect, it } from "vitest";

import { validateQueryDocument } from "./validator/document";

describe("shared query-engine recipes", () => {
	it("produces documents accepted by the query language validator", () => {
		const documents = [
			buildEntityDetailQueryDocument({ entityId: "entity", entitySchemaSlug: "book" }),
			buildEntityInterestQueryDocument({ entityIds: ["entity"], entitySchemaSlugs: ["book"] }),
			buildEventHistoryQueryDocument({
				page: 1,
				eventSchemaSlugs: ["complete"],
				entitySchemaSlugs: ["book"],
			}),
			buildAllCollectionsQueryDocument({}),
			buildDefaultSavedViewQueryDocument({ schemas: ["book"] }),
			buildDefaultMediaSavedViewQueryDocument({ schemas: ["book"] }),
			buildShowDetailQueryDocument({ entityId: "show", seasonLimit: 10, episodeLimit: 10 }),
			buildInProgressShowsQueryDocument({}),
			buildCompletedShowsQueryDocument({}),
			buildPodcastDetailQueryDocument({ entityId: "podcast", episodeLimit: 10 }),
			buildInProgressPodcastsQueryDocument({}),
			buildCompletedPodcastsQueryDocument({}),
			buildPersonalMediaSuggestionsQueryDocument({ entitySchemaSlug: "book" }),
			buildCollectionMediaSuggestionsQueryDocument({
				entitySchemaSlug: "book",
				collectionId: "collection",
			}),
			buildTrendingMediaQueryDocument({
				entitySchemaSlug: "book",
				fetchedAt: "2026-01-01T00:00:00.000Z",
			}),
			buildExerciseListQueryDocument({}),
			buildWorkoutListQueryDocument({}),
			buildMeasurementListQueryDocument({}),
			buildWorkoutTemplateListQueryDocument({}),
			buildWorkoutDetailQueryDocument({ entityId: "workout", templateLimit: 1 }),
			buildWorkoutTemplateDetailQueryDocument({ entityId: "template", workoutLimit: 10 }),
		] satisfies readonly QueryDocument[];

		expect(documents.map(validateQueryDocument)).toEqual(documents.map(() => null));
	});
});
