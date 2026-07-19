import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { describe, expect, it } from "vitest";

import { showEpisodicKindConfig } from "../../shared/lifecycle-expressions";
import {
	episodicLifecycleSnapshotRecipe,
	readEpisodicLifecycleSnapshot,
} from "./lifecycle-recipes";

const input = { parentEntityId: "show-1", config: showEpisodicKindConfig };

describe("media lifecycle recipes", () => {
	it("builds the episodic snapshot as one parent query without pagination", () => {
		const recipe = episodicLifecycleSnapshotRecipe(input);

		expect(Object.keys(recipe.document.queries)).toEqual(["parent"]);
		const query = recipe.document.queries["parent"];
		if (query?.output.type !== "rows") {
			throw new Error("Expected lifecycle parent rows query");
		}
		expect(query.output.pagination).toEqual({ limit: 2 });
		expect(query.output.fields.map((field) => ("key" in field ? field.key : null))).toEqual(
			expect.arrayContaining([
				"boundaryId",
				"coverageComplete",
				"agreedConsumedOn",
				"closingId",
				"closingCreatedAt",
				"closingOccurredAt",
			]),
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

	it("executes and decodes one query per snapshot read", async () => {
		let calls = 0;
		const snapshot = await Effect.runPromise(
			readEpisodicLifecycleSnapshot(input, (document) => {
				calls += 1;
				expect(Object.keys(document.queries)).toEqual(["parent"]);
				return Effect.succeed({
					data: {
						parent: {
							type: "rows",
							pageInfo: { limit: 2, hasMore: false, nextCursor: null },
							items: [
								{
									boundaryId: null,
									state: "caught_up",
									entityId: "episode-2",
									coverageComplete: true,
									boundaryCreatedAt: null,
									id: "episode-complete-2",
									boundaryOccurredAt: null,
									parentEntityId: "show-1",
									agreedConsumedOn: "Plex",
									productionStatus: "Ended",
									eventSchemaSlug: "complete",
									coverageStructureValid: true,
									closingId: "episode-complete-2",
									createdAt: "2026-01-03T00:00:00.000Z",
									occurredAt: "2026-01-03T00:00:00.000Z",
									closingCreatedAt: "2026-01-03T00:00:00.000Z",
									closingOccurredAt: "2026-01-03T00:00:00.000Z",
								},
							],
						},
					},
				});
			}),
		);

		expect(calls).toBe(1);
		expect(snapshot).toMatchObject({
			coverageComplete: true,
			parentEntityId: "show-1",
			agreedConsumedOn: "Plex",
			coverageClosingEvent: {
				id: "episode-complete-2",
				createdAt: "2026-01-03T00:00:00.000Z",
				occurredAt: "2026-01-03T00:00:00.000Z",
			},
		});
	});
});
