import { mediaActivityLogContextRecipe } from "@ryot-app/media-plugin/shared/activity-log-recipes";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	waitForCreateEvents,
} from "~/fixtures/kernel";
import {
	createBuiltinMediaLifecycleFixture,
	logMediaActivity,
	mediaReferenceForEntity,
	seedShow,
	seedShowEpisode,
} from "~/fixtures/plugins/media";
import {
	historyEventsFor,
	settledHistoryCorrection,
} from "~/fixtures/plugins/media/history-correction";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

describe("Media history correction", () => {
	it.live("captures independent parent completions concurrently in one library", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const shows = [];
			for (let index = 0; index < 2; index += 1) {
				shows.push(
					yield* seedShow(client, {
						properties: { productionStatus: "Ended" },
						seasons: [
							{ seasonNumber: 1, episodes: [{ episodeNumber: 1, publishDate: "2020-01-01" }] },
						],
					}),
				);
			}
			yield* Effect.forEach(
				shows,
				(show) =>
					logMediaActivity(client, {
						submittedAt: nowIso(),
						submissionId: crypto.randomUUID(),
						entry: {
							kind: "episodes",
							parentEntityId: show.show.id,
							episodeEntityIds: show.episodes.map((episode) => episode.id),
							when: { kind: "date", finishedOn: "2026-01-01T12:00:00.000Z" },
						},
					}),
				{ concurrency: 2 },
			);
			yield* settledHistoryCorrection(client, userId);
			for (const show of shows) {
				expect(
					(yield* historyEventsFor(client, show.show.id)).filter(
						(row) => row.eventSchemaSlug === "complete",
					),
				).toHaveLength(1);
			}
		}),
	);

	it.live("keeps an independent explicit completion after its earlier progress is deleted", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const movie = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const response = yield* client.call((c) =>
				c.events.create({
					payload: [
						{
							entityId: movie.entityId,
							properties: { progressPercent: 100 },
							occurredAt: "2026-01-01T12:00:00.000Z",
							eventSchemaSlug: movie.progressEventSchemaSlug,
						},
						{
							entityId: movie.entityId,
							properties: { timeSpent: 90 },
							occurredAt: "2026-01-02T12:00:00.000Z",
							eventSchemaSlug: movie.completeEventSchemaSlug,
						},
					],
				}),
			);
			yield* waitForCreateEvents(client, response);
			yield* settledHistoryCorrection(client, userId);
			const events = yield* historyEventsFor(client, movie.entityId);
			const progress = requirePresent(
				events.find((row) => row.eventSchemaSlug === "progress"),
				"Progress missing",
			);
			const explicit = requirePresent(
				events.find(
					(row) => row.eventSchemaSlug === "complete" && row.properties["timeSpent"] === 90,
				),
				"Explicit completion missing",
			);
			yield* client.call((c) => c.events.delete({ params: { eventId: progress.id } }));
			yield* settledHistoryCorrection(client, userId);
			expect(
				(yield* historyEventsFor(client, movie.entityId)).filter(
					(row) => row.eventSchemaSlug === "complete",
				),
			).toEqual([explicit]);
		}),
	);

	it.live(
		"keeps same-time source order when later progress reopens an automatically completed item",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const movie = yield* createBuiltinMediaLifecycleFixture(client, {
					entitySchemaSlug: "movie",
				});
				const response = yield* client.call((c) =>
					c.events.create({
						payload: [100, 50].map((progressPercent) => ({
							entityId: movie.entityId,
							properties: { progressPercent },
							occurredAt: "2026-01-01T12:00:00.000Z",
							eventSchemaSlug: movie.progressEventSchemaSlug,
						})),
					}),
				);
				yield* waitForCreateEvents(client, response);
				yield* settledHistoryCorrection(client, userId);
				expect(
					(yield* historyEventsFor(client, movie.entityId)).filter(
						(row) => row.eventSchemaSlug === "complete",
					),
				).toHaveLength(1);
				const reference = yield* mediaReferenceForEntity(client, movie.entityId);
				const context = yield* executeRyotQLRecipe(
					client,
					mediaActivityLogContextRecipe({ reference, entityId: movie.entityId }),
				);
				expect(context).toMatchObject({ progressPercent: 50, state: "in_progress" });
			}),
	);

	it.live(
		"repairs generic progress edits and keeps an explicitly edited automatic completion",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const movie = yield* createBuiltinMediaLifecycleFixture(client, {
					entitySchemaSlug: "movie",
				});
				const created = yield* client.call((c) =>
					c.events.create({
						payload: [
							{
								entityId: movie.entityId,
								properties: { progressPercent: 90 },
								occurredAt: "2026-01-01T12:00:00.000Z",
								eventSchemaSlug: movie.progressEventSchemaSlug,
							},
						],
					}),
				);
				yield* waitForCreateEvents(client, created);
				yield* settledHistoryCorrection(client, userId);
				const progress = requirePresent(
					(yield* historyEventsFor(client, movie.entityId)).find(
						(row) => row.eventSchemaSlug === "progress",
					),
					"Progress missing",
				);
				yield* client.call((c) =>
					c.events.update({
						params: { eventId: progress.id },
						payload: { properties: { remove: [], set: { progressPercent: 100 } } },
					}),
				);
				yield* settledHistoryCorrection(client, userId);
				const completed = requirePresent(
					(yield* historyEventsFor(client, movie.entityId)).find(
						(row) => row.eventSchemaSlug === "complete",
					),
					"Completion missing",
				);
				expect(completed.properties).toMatchObject({ completionSilent: true });
				yield* client.call((c) =>
					c.events.update({
						params: { eventId: progress.id },
						payload: { occurredAt: "2026-01-02T12:00:00.000Z" },
					}),
				);
				yield* settledHistoryCorrection(client, userId);
				const repaired = (yield* historyEventsFor(client, movie.entityId)).filter(
					(row) => row.eventSchemaSlug === "complete",
				);
				expect(repaired).toMatchObject([
					{ id: completed.id, occurredAt: "2026-01-02T12:00:00.000Z" },
				]);
				yield* client.call((c) =>
					c.events.update({
						params: { eventId: completed.id },
						payload: { properties: { remove: [], set: { timeSpent: 123 } } },
					}),
				);
				yield* settledHistoryCorrection(client, userId);
				yield* client.call((c) =>
					c.events.update({
						params: { eventId: progress.id },
						payload: { properties: { remove: [], set: { progressPercent: 50 } } },
					}),
				);
				yield* settledHistoryCorrection(client, userId);
				const explicit = (yield* historyEventsFor(client, movie.entityId)).filter(
					(row) => row.eventSchemaSlug === "complete",
				);
				expect(explicit).toMatchObject([{ id: completed.id, properties: { timeSpent: 123 } }]);
				expect(explicit[0]?.properties).not.toHaveProperty("completionKey");
			}),
	);

	it.live(
		"repairs an episodic parent's date and removes it after deleting supporting history",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const show = yield* seedShow(client, {
					properties: { productionStatus: "Ended" },
					seasons: [
						{
							seasonNumber: 1,
							episodes: [
								{ episodeNumber: 1, publishDate: "2020-01-01" },
								{ episodeNumber: 2, publishDate: "2020-01-02" },
							],
						},
					],
				});
				yield* logMediaActivity(client, {
					submittedAt: nowIso(),
					submissionId: crypto.randomUUID(),
					entry: {
						kind: "episodes",
						parentEntityId: show.show.id,
						episodeEntityIds: show.episodes.map((episode) => episode.id),
						when: { kind: "date", finishedOn: "2026-01-01T12:00:00.000Z" },
					},
				});
				yield* settledHistoryCorrection(client, userId);
				const parent = requirePresent(
					(yield* historyEventsFor(client, show.show.id)).find(
						(row) => row.eventSchemaSlug === "complete",
					),
					"Parent completion missing",
				);
				yield* seedShowEpisode(client, {
					seasonNumber: 1,
					suffix: crypto.randomUUID(),
					episode: { episodeNumber: 3, publishDate: "2020-01-03" },
					seasonId: requirePresent(show.seasons[0], "Season missing").id,
				});
				const child = requirePresent(
					(yield* historyEventsFor(client, show.episodeId(1, 2))).find(
						(row) => row.eventSchemaSlug === "complete",
					),
					"Child completion missing",
				);
				yield* client.call((c) =>
					c.events.update({
						params: { eventId: child.id },
						payload: { occurredAt: "2026-01-03T12:00:00.000Z" },
					}),
				);
				yield* settledHistoryCorrection(client, userId);
				expect(
					(yield* historyEventsFor(client, show.show.id)).filter(
						(row) => row.eventSchemaSlug === "complete",
					),
				).toMatchObject([{ id: parent.id, occurredAt: "2026-01-03T12:00:00.000Z" }]);
				yield* client.call((c) => c.events.delete({ params: { eventId: child.id } }));
				yield* settledHistoryCorrection(client, userId);
				expect(
					(yield* historyEventsFor(client, show.show.id)).filter(
						(row) => row.eventSchemaSlug === "complete",
					),
				).toEqual([]);
			}),
	);

	it.live(
		"does not recreate a deleted automatic occurrence on later corrections or concurrent writes",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const movie = yield* createBuiltinMediaLifecycleFixture(client, {
					entitySchemaSlug: "movie",
				});
				const created = yield* client.call((c) =>
					c.events.create({
						payload: [
							{
								entityId: movie.entityId,
								properties: { progressPercent: 100 },
								occurredAt: "2026-01-01T12:00:00.000Z",
								eventSchemaSlug: movie.progressEventSchemaSlug,
							},
						],
					}),
				);
				yield* waitForCreateEvents(client, created);
				yield* settledHistoryCorrection(client, userId);
				const events = yield* historyEventsFor(client, movie.entityId);
				const progress = requirePresent(
					events.find((row) => row.eventSchemaSlug === "progress"),
					"Progress missing",
				);
				const completion = requirePresent(
					events.find((row) => row.eventSchemaSlug === "complete"),
					"Completion missing",
				);
				yield* client.call((c) => c.events.delete({ params: { eventId: completion.id } }));
				yield* settledHistoryCorrection(client, userId);
				yield* client.call((c) =>
					c.events.update({
						params: { eventId: progress.id },
						payload: { occurredAt: "2026-01-02T12:00:00.000Z" },
					}),
				);
				yield* settledHistoryCorrection(client, userId);
				expect(
					(yield* historyEventsFor(client, movie.entityId)).filter(
						(row) => row.eventSchemaSlug === "complete",
					),
				).toEqual([]);
				const responses = yield* Effect.forEach(
					[3, 4],
					(day) =>
						client.call((c) =>
							c.events.create({
								payload: [
									{
										entityId: movie.entityId,
										properties: { progressPercent: 100 },
										occurredAt: `2026-01-0${day}T12:00:00.000Z`,
										eventSchemaSlug: movie.progressEventSchemaSlug,
									},
								],
							}),
						),
					{ concurrency: 2 },
				);
				for (const response of responses) {
					yield* waitForCreateEvents(client, response);
				}
				yield* settledHistoryCorrection(client, userId);
				expect(
					(yield* historyEventsFor(client, movie.entityId)).filter(
						(row) => row.eventSchemaSlug === "complete",
					),
				).toHaveLength(2);
			}),
	);
});
