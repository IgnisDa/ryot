import { AutomationHookSlug, UserId } from "@ryot-app/contract/schema/brands";
import { mediaActivityLogContextRecipe } from "@ryot-app/media-plugin/shared/activity-log-recipes";
import {
	ascending,
	column,
	defineRecipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Effect, Result, Schema } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	listEventsForEntity,
	pollTerminalAutomationRuns,
	waitForCreateEvents,
} from "~/fixtures/kernel";
import { pollUntil } from "~/fixtures/kernel/polling";
import {
	createBuiltinMediaLifecycleFixture,
	logMediaActivity,
	mediaReferenceForEntity,
	seedShow,
	seedShowEpisode,
} from "~/fixtures/plugins/media";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

const eventsFor = (client: Parameters<typeof listEventsForEntity>[0], entityId: string) =>
	listEventsForEntity(client, entityId, undefined, 100);

const workRecipe = defineRecipe(() => {
	const work = table("userWork", "work");
	return {
		map: ({ work: rows }) => Result.succeed(rows),
		queries: {
			work: selectedRows(work, {
				limit: 100,
				orderBy: [ascending(column(work, "id"))],
				selection: {
					status: selectedField(column(work, "status"), Schema.String),
					error: selectedField(column(work, "error"), Schema.NullOr(Schema.String)),
				},
			}),
		},
	};
});

const settled = (client: Parameters<typeof eventsFor>[0], userId: string) =>
	pollTerminalAutomationRuns({
		executionUserId: UserId.make(userId),
		hookSlug: AutomationHookSlug.make("media.reconcile-history"),
	}).pipe(
		Effect.tap((runs) =>
			Effect.sync(() => expect(runs.map((run) => run.status)).toEqual(runs.map(() => "succeeded"))),
		),
		Effect.andThen(
			pollUntil(
				"history correction work",
				executeRyotQLRecipe(client, workRecipe()).pipe(
					Effect.map((page) => {
						expect(page.items.filter((row) => row.status === "failed")).toEqual([]);
						return page.items.some((row) => row.status === "queued" || row.status === "running")
							? null
							: page;
					}),
				),
			),
		),
	);

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
			yield* settled(client, userId);
			for (const show of shows) {
				expect(
					(yield* eventsFor(client, show.show.id)).filter(
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
			yield* settled(client, userId);
			const events = yield* eventsFor(client, movie.entityId);
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
			yield* settled(client, userId);
			expect(
				(yield* eventsFor(client, movie.entityId)).filter(
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
				yield* settled(client, userId);
				expect(
					(yield* eventsFor(client, movie.entityId)).filter(
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
				yield* settled(client, userId);
				const progress = requirePresent(
					(yield* eventsFor(client, movie.entityId)).find(
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
				yield* settled(client, userId);
				const completed = requirePresent(
					(yield* eventsFor(client, movie.entityId)).find(
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
				yield* settled(client, userId);
				const repaired = (yield* eventsFor(client, movie.entityId)).filter(
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
				yield* settled(client, userId);
				yield* client.call((c) =>
					c.events.update({
						params: { eventId: progress.id },
						payload: { properties: { remove: [], set: { progressPercent: 50 } } },
					}),
				);
				yield* settled(client, userId);
				const explicit = (yield* eventsFor(client, movie.entityId)).filter(
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
				yield* settled(client, userId);
				const parent = requirePresent(
					(yield* eventsFor(client, show.show.id)).find(
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
					(yield* eventsFor(client, show.episodeId(1, 2))).find(
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
				yield* settled(client, userId);
				expect(
					(yield* eventsFor(client, show.show.id)).filter(
						(row) => row.eventSchemaSlug === "complete",
					),
				).toMatchObject([{ id: parent.id, occurredAt: "2026-01-03T12:00:00.000Z" }]);
				yield* client.call((c) => c.events.delete({ params: { eventId: child.id } }));
				yield* settled(client, userId);
				expect(
					(yield* eventsFor(client, show.show.id)).filter(
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
				yield* settled(client, userId);
				const events = yield* eventsFor(client, movie.entityId);
				const progress = requirePresent(
					events.find((row) => row.eventSchemaSlug === "progress"),
					"Progress missing",
				);
				const completion = requirePresent(
					events.find((row) => row.eventSchemaSlug === "complete"),
					"Completion missing",
				);
				yield* client.call((c) => c.events.delete({ params: { eventId: completion.id } }));
				yield* settled(client, userId);
				yield* client.call((c) =>
					c.events.update({
						params: { eventId: progress.id },
						payload: { occurredAt: "2026-01-02T12:00:00.000Z" },
					}),
				);
				yield* settled(client, userId);
				expect(
					(yield* eventsFor(client, movie.entityId)).filter(
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
				yield* settled(client, userId);
				expect(
					(yield* eventsFor(client, movie.entityId)).filter(
						(row) => row.eventSchemaSlug === "complete",
					),
				).toHaveLength(2);
			}),
	);
});
