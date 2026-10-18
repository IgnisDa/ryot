import { expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";

import {
	automationContext,
	eventAutomationContext,
	eventBatchContext,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./library-summary-refresh.sandbox";

const requestedIds = (context: ReturnType<typeof automationContext>) => {
	const requests: Array<readonly string[]> = [];
	return definition
		.run(
			context,
			defineSandboxTestHost(manifest, {
				requestRelationshipProjections: (request) => {
					expect(request.relationshipSchemaSlug).toBe("in-media-library");
					requests.push(request.sourceEntityIds);
					return Effect.succeed({ workId: "work-1" });
				},
			}),
		)
		.pipe(Effect.as(requests));
};

it.effect("refreshes the titles of changed events, preferring the episode session title", () =>
	Effect.gen(function* () {
		const created = eventAutomationContext({ entityId: "movie-1" }).automation.payload;
		if (created.resource !== "event" || created.operation !== "create") {
			throw new Error("Expected event create change");
		}
		const event = created.after;
		const moved = {
			...created,
			operation: "update",
			changedProperties: [],
			after: { ...event, entityId: "movie-3" },
			before: { ...event, entityId: "movie-2" },
		};
		const deleted = {
			resource: "event",
			category: "change",
			operation: "delete",
			before: {
				...event,
				entityId: "episode-1",
				sessionEntityId: "show-1",
				entitySchemaSlug: "show-episode",
			},
		};
		expect(
			yield* requestedIds(
				automationContext({
					resource: "event",
					category: "change",
					operation: "batch",
					items: [created, moved, deleted],
				}),
			),
		).toEqual([["movie-1", "movie-2", "movie-3", "show-1"]]);
	}),
);

it.effect("splits large batches into requests of at most 100 titles", () =>
	Effect.gen(function* () {
		const requests = yield* requestedIds(
			eventBatchContext(
				...Array.from({ length: 150 }, (_, index) => ({ entityId: `movie-${index}` })),
			),
		);
		expect(requests.map((ids) => ids.length)).toEqual([100, 50]);
	}),
);

it.effect("refreshes titles that join the media library", () =>
	Effect.gen(function* () {
		const membership = {
			properties: {},
			id: "relationship-1",
			sourceEntityId: "book-1",
			targetEntityId: "library-1",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			relationshipSchemaPluginId: "media-owner",
			relationshipSchemaSlug: "in-media-library",
		};
		expect(
			yield* requestedIds(
				automationContext({
					category: "change",
					operation: "batch",
					resource: "relationship",
					items: [
						{
							after: membership,
							category: "change",
							operation: "create",
							resource: "relationship",
						},
					],
				}),
			),
		).toEqual([["book-1"]]);
	}),
);
