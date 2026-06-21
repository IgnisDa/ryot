import type { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import {
	buildCollectionMediaSuggestionsQueryDocument,
	buildCompletedPodcastsQueryDocument,
	buildCompletedShowsQueryDocument,
	buildDefaultSavedViewQueryDocument,
	buildEntityDetailQueryDocument,
	buildEntityInterestQueryDocument,
	buildEventHistoryQueryDocument,
	buildExerciseListQueryDocument,
	buildInProgressPodcastsQueryDocument,
	buildInProgressShowsQueryDocument,
	buildMeasurementListQueryDocument,
	buildMediaMonitoringStatusQueryDocument,
	buildPersonalMediaSuggestionsQueryDocument,
	buildPodcastDetailQueryDocument,
	buildShowDetailQueryDocument,
	buildTrendingMediaQueryDocument,
	buildWorkoutDetailQueryDocument,
	buildWorkoutListQueryDocument,
	buildWorkoutTemplateDetailQueryDocument,
	buildWorkoutTemplateListQueryDocument,
} from "@ryot/query-engine";
import { describe, expect, it } from "vitest";

import { validateQueryDocument } from "./validator/document";

describe("shared query-engine recipes", () => {
	it("produces documents accepted by the query language validator", () => {
		const documents = [
			buildEntityDetailQueryDocument({ entityId: "entity", entitySchemaSlug: "book" }),
			buildEntityInterestQueryDocument({
				entityIds: ["entity"],
				entitySchemaSlugs: ["book"],
			}),
			buildEventHistoryQueryDocument({
				page: 1,
				eventSchemaSlugs: ["complete"],
				entitySchemaSlugs: ["book"],
			}),
			buildDefaultSavedViewQueryDocument({ schemas: ["book"], requireInLibrary: true }),
			buildMediaMonitoringStatusQueryDocument({ entityId: "entity", entitySchemaSlug: "book" }),
			buildShowDetailQueryDocument({ entityId: "show", seasonLimit: 10, episodeLimit: 10 }),
			buildInProgressShowsQueryDocument({}),
			buildCompletedShowsQueryDocument({}),
			buildPodcastDetailQueryDocument({ entityId: "podcast", episodeLimit: 10 }),
			buildInProgressPodcastsQueryDocument({}),
			buildCompletedPodcastsQueryDocument({}),
			buildPersonalMediaSuggestionsQueryDocument({ entitySchemaSlug: "book" }),
			buildCollectionMediaSuggestionsQueryDocument({
				collectionId: "collection",
				entitySchemaSlug: "book",
			}),
			buildTrendingMediaQueryDocument({
				fetchedAt: "2026-01-01T00:00:00.000Z",
				entitySchemaSlug: "book",
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
