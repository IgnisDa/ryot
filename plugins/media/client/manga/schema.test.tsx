import { afterEach, describe, expect, it } from "bun:test";

import { Effect, Result } from "@ryot-app/plugin-client-sdk/effect";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";

import { mangaRecipes } from "../../shared/manga-recipes";
import {
	decodeFlatOverview,
	FLAT_OVERVIEW_INPUT,
	flatPersonRow,
} from "../../tests/client/flat-media/overview-fixture";
import { decodeFlatPresentation } from "../../tests/client/flat-media/presentation-fixture";
import {
	decodeFlatSummary,
	FLAT_SUMMARY_INPUT,
} from "../../tests/client/flat-media/summary-fixture";
import { readyQueryResult, rowsResult } from "../../tests/client/query-result-fixture";
import { renderMediaScreenBody } from "../../tests/client/screen-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { mangaPresentationFacts, mangaSchema, mangaSummaryFacts } from "./schema";

const noopAdapter = {
	query: () => Effect.succeed({}),
	watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
};

const PROGRESS_EVENT = {
	text: null,
	rating: null,
	properties: {},
	timeSpent: null,
	startedOn: null,
	isSpoiler: null,
	listState: null,
	dateUnknown: null,
	progressPercent: 62,
	entityId: "entity-1",
	id: "manga-progress",
	sessionEntityId: null,
	consumedOn: ["Kavita"],
	eventSchemaSlug: "progress",
	createdAt: "2025-11-03T12:00:05.000Z",
	occurredAt: "2025-11-03T12:00:00.000Z",
	position: { volume: 3, position: 45, unit: "chapters" },
};

const mangaSummary = (overrides: Record<string, unknown> = {}) =>
	decodeFlatSummary(
		bindRecipe(mangaRecipes.summaryRecipe({ reference: FLAT_SUMMARY_INPUT.reference }), {
			entityId: FLAT_SUMMARY_INPUT.entityId,
		}),
		{ volumes: 12, chapters: 120, ...overrides },
	);
const mangaActivity = (events: readonly Record<string, unknown>[] = [PROGRESS_EVENT]) =>
	Result.getOrThrow(
		bindRecipe(mangaRecipes.activityRecipe({ reference: { kind: "self" } }), {
			entityId: "manga-1",
		}).decode({
			data: {
				events: rowsResult(events, { limit: 60, hasMore: false, nextCursor: null }),
				collectionEvents: rowsResult([], { limit: 60, hasMore: false, nextCursor: null }),
				totals: rowsResult(
					[
						{
							completionCount: 1,
							consumedAmount: 120,
							unknownAmountCount: 0,
							consumptionProcessing: "ready",
						},
					],
					{ limit: 1, hasMore: false, nextCursor: null },
				),
			},
		}),
	);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("manga schema", () => {
	it("lists the chapter and volume facts and drops the unrecorded ones", () => {
		expect(mangaSummaryFacts(mangaSummary())).toEqual([
			{ inline: true, icon: "book-open", label: "Chapters", value: "120 chapters" },
			{ inline: true, icon: "layers", label: "Volumes", value: "12 volumes" },
		]);
		expect(mangaSummaryFacts(mangaSummary({ volumes: null, chapters: null }))).toEqual([]);
	});

	it("labels each imported chapter on its own activity row", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<mangaSchema.Activity
				compact
				entityId="media-1"
				refresh={() => undefined}
				state={mangaSchema.mapActivity(
					readyQueryResult(
						mangaActivity([
							PROGRESS_EVENT,
							{
								...PROGRESS_EVENT,
								id: "manga-progress-46",
								createdAt: "2025-11-04T12:00:05.000Z",
								occurredAt: "2025-11-04T12:00:00.000Z",
								position: { position: 46.5, unit: "chapters" },
							},
						]),
					),
				)}
			/>,
		);

		expect(container.textContent).toContain("Ch 45 · Vol 3");
		expect(container.textContent).toContain("Ch 46.5");
		expect(container.textContent).not.toContain("62% through the manga");
		expect(container.textContent).toContain("Chapters");
		expect(container.textContent).toContain("120");
		unmount();
	});

	it("names the credit rails for a manga and never claims it is part of a series", () => {
		const { unmount, container } = renderMediaScreenBody(
			mangaSchema,
			mangaSummary(),
			decodeFlatOverview(
				bindRecipe(mangaRecipes.overviewRecipe({ reference: FLAT_OVERVIEW_INPUT.reference }), {
					entityId: FLAT_OVERVIEW_INPUT.entityId,
				}),
			),
		);

		expect(container.textContent).toContain("Authors & artists");
		expect(container.textContent).toContain("Publishers");
		expect(container.textContent).toContain(flatPersonRow.name);
		expect(container.textContent).not.toContain("Part of");
		unmount();
	});

	it("reads the chapter count on cards and hints how much was read", () => {
		const data = decodeFlatPresentation(mangaRecipes, {
			chapters: 120,
			progressPercent: 62,
			schemaSlug: "manga",
		});

		expect(mangaPresentationFacts(data)).toEqual(["120 chapters"]);
		expect(mangaPresentationFacts({ ...data, chapters: 1 })).toEqual(["1 chapter"]);
		expect(mangaPresentationFacts({ ...data, chapters: null })).toEqual([]);
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<mangaSchema.CardContent compact data={data} entityId="media-1" />,
		);
		expect(container.textContent).toContain("120 chapters");
		expect(container.textContent).toContain("62% read");
		unmount();
	});
});
