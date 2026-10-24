import { describe, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import {
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import { ryotqlDocumentNodes } from "../../tests/ryotql-test-utils";
import {
	episodicLifecycleSnapshotRecipe,
	readEpisodicLifecycleSnapshot,
} from "./lifecycle-recipes";

const input = {
	parentEntityId: "show-1",
	reference: { kind: "self" },
	config: showEpisodicKindConfig,
} satisfies Parameters<typeof episodicLifecycleSnapshotRecipe>[0];

describe("media lifecycle recipes", () => {
	it.each([showEpisodicKindConfig, podcastEpisodicKindConfig])(
		"selects only completion-consumer fields in one bounded $kind parent query",
		(config) => {
			const recipe = episodicLifecycleSnapshotRecipe({ ...input, config });

			expect(Object.keys(recipe.document.queries)).toEqual(["parent"]);
			const query = recipe.document.queries["parent"];
			if (query?.output.type !== "rows") {
				throw new Error("Expected lifecycle parent rows query");
			}
			expect(query.output.pagination).toEqual({ limit: 2 });
			expect(query.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual([
				"parentEntityId",
				"state",
				"allDatesUnknown",
				"closingId",
				"agreedConsumedOn",
				"boundaryId",
				"closingCreatedAt",
				"closingOccurredAt",
				"boundaryCreatedAt",
				"boundaryOccurredAt",
				"coverageComplete",
				"productionStatus",
			]);
		},
	);

	it("retains aggregate signals for state and the nonempty-coverage guard within calculations", () => {
		const query = episodicLifecycleSnapshotRecipe(input).document.queries["parent"];
		if (query?.output.type !== "rows") {
			throw new Error("Expected lifecycle parent rows query");
		}
		const state = query.output.fields.find((field) => "key" in field && field.key === "state");
		const coverage = query.output.fields.find(
			(field) => "key" in field && field.key === "coverageComplete",
		);
		expect(ryotqlDocumentNodes(state)).toContainEqual(
			expect.objectContaining({ tableAlias: "lifecycleSnapshotSignalEvent" }),
		);
		expect(ryotqlDocumentNodes(coverage)).toContainEqual(
			expect.objectContaining({
				operator: "gt",
				right: { value: 0, type: "literal" },
				left: expect.objectContaining({ aggregation: { function: "count" } }),
			}),
		);
	});

	it("derives current coverage completions after progress and the parent boundary", () => {
		const document = JSON.stringify(episodicLifecycleSnapshotRecipe(input).document);

		expect(document).toContain('"tableAlias":"lifecycleSnapshotCompletionEpisodeProgress"');
		expect(document).toContain('"tableAlias":"lifecycleSnapshotCompletionEpisodeCompletion"');
		expect(document).toContain('"tableAlias":"lifecycleSnapshotCompletionEpisodeBoundary"');
		expect(document).toContain('"value":"progress"');
		expect(document).toContain('"value":"complete"');
		expect(document).toContain('"direction":"asc"');
		expect(document).toContain('"function":"countDistinct"');
	});

	it("judges coverage and consumedOn agreement over the same aired regular episodes", () => {
		const document = JSON.stringify(episodicLifecycleSnapshotRecipe(input).document);

		expect(document).toContain('"alias":"lifecycleSnapshotCoverageRequiredSeason"');
		expect(document).toContain('"alias":"lifecycleSnapshotCompletionSeason"');
		expect(document.match(/"type":"currentDate"/g)?.length).toBeGreaterThanOrEqual(2);
		expect(document).not.toContain("episodeOrders");
	});

	it("judges podcast coverage through direct episode relationships without seasons", () => {
		const document = JSON.stringify(
			episodicLifecycleSnapshotRecipe({ ...input, config: podcastEpisodicKindConfig }).document,
		);

		expect(document).toContain('"value":"podcast-to-podcast-episode"');
		expect(document).toContain('"value":"podcast-episode"');
		expect(document).toContain('"type":"currentDate"');
		expect(document).not.toContain("seasonNumber");
		expect(document).not.toContain("show-season");
	});

	it.live.each([
		null,
		{
			id: "parent-complete-1",
			createdAt: "2026-01-01T00:00:00.000Z",
			occurredAt: "2026-01-01T00:00:00.000Z",
		},
	])("executes and decodes only consumed fields with boundary %j", (boundary) =>
		Effect.gen(function* () {
			let calls = 0;
			const snapshot = yield* readEpisodicLifecycleSnapshot(input, (document) => {
				calls += 1;
				expect(Object.keys(document.queries)).toEqual(["parent"]);
				return Effect.succeed({
					data: {
						parent: {
							type: "rows",
							pageInfo: { limit: 2, hasMore: false, nextCursor: null },
							items: [
								{
									state: "caught_up",
									allDatesUnknown: true,
									coverageComplete: true,
									parentEntityId: "show-1",
									agreedConsumedOn: "Plex",
									productionStatus: "Ended",
									closingId: "episode-complete-2",
									boundaryId: boundary?.id ?? null,
									closingCreatedAt: "2026-01-03T00:00:00.000Z",
									closingOccurredAt: "2026-01-03T00:00:00.000Z",
									boundaryCreatedAt: boundary?.createdAt ?? null,
									boundaryOccurredAt: boundary?.occurredAt ?? null,
								},
							],
						},
					},
				});
			});

			expect(calls).toBe(1);
			expect(snapshot).toEqual({
				state: "caught_up",
				allDatesUnknown: true,
				coverageComplete: true,
				parentEntityId: "show-1",
				agreedConsumedOn: "Plex",
				productionStatus: "Ended",
				boundaryCompleteEvent: boundary,
				coverageClosingEvent: {
					id: "episode-complete-2",
					createdAt: "2026-01-03T00:00:00.000Z",
					occurredAt: "2026-01-03T00:00:00.000Z",
				},
			});
		}),
	);
});
