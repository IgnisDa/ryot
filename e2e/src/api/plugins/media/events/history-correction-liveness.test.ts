import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import { listEventsForEntity } from "~/fixtures/kernel/events";
import {
	createBuiltinMediaLifecycleFixture,
	logMediaActivity,
	seedShow,
} from "~/fixtures/plugins/media";
import { historyEventsFor } from "~/fixtures/plugins/media/history-correction";
import { describe, expect, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

const completionsFor = (client: Client, entityId: string) =>
	historyEventsFor(client, entityId).pipe(
		Effect.map((rows) => rows.filter((row) => row.eventSchemaSlug === "complete")),
	);

describe("Media history settling", () => {
	it.live("completes every subject of a write that fans out across 60 subjects", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const movies = yield* Effect.forEach(
				Array.from({ length: 75 }),
				() => createBuiltinMediaLifecycleFixture(client, { entitySchemaSlug: "movie" }),
				{ concurrency: 8 },
			);
			const create = (batch: typeof movies) =>
				client.call((c) =>
					c.events.create({
						payload: batch.map((movie) => ({
							entityId: movie.entityId,
							properties: { progressPercent: 100 },
							occurredAt: "2026-01-01T12:00:00.000Z",
							eventSchemaSlug: movie.progressEventSchemaSlug,
						})),
					}),
				);
			yield* Effect.all([create(movies.slice(0, 60)), create(movies.slice(60))], {
				concurrency: 2,
			});
			yield* Effect.forEach(
				movies,
				(movie) =>
					completionsFor(client, movie.entityId).pipe(
						Effect.tap((rows) => Effect.sync(() => expect(rows).toHaveLength(1))),
					),
				{ concurrency: 8 },
			);
		}),
	);

	it.live("completes a 70-episode show in the write that covers its last episode", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const show = yield* seedShow(client, {
				properties: { productionStatus: "Ended" },
				seasons: [
					{
						seasonNumber: 1,
						episodes: Array.from({ length: 70 }, (_, index) => ({
							episodeNumber: index + 1,
							publishDate: "2020-01-01",
						})),
					},
				],
			});
			yield* logMediaActivity(client, {
				submittedAt: nowIso(),
				submissionId: yield* randomUuid,
				entry: {
					kind: "episodes",
					parentEntityId: show.show.id,
					episodeEntityIds: show.episodes.map((episode) => episode.id),
					when: { kind: "date", finishedOn: "2026-01-01T12:00:00.000Z" },
				},
			});
			const history = yield* listEventsForEntity(client, show.show.id, undefined, 100);
			expect(history.filter((row) => row.eventSchemaSlug === "complete")).toHaveLength(1);
		}),
	);

	it.live("keeps every edited automatic completion explicit", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const movie = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			yield* client.call((c) =>
				c.events.create({
					payload: Array.from({ length: 30 }, (_, index) => ({
						entityId: movie.entityId,
						properties: { progressPercent: 100 },
						eventSchemaSlug: movie.progressEventSchemaSlug,
						occurredAt: `2026-01-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
					})),
				}),
			);
			const automatic = yield* completionsFor(client, movie.entityId);
			expect(automatic).toHaveLength(30);
			yield* Effect.forEach(
				automatic,
				(completion) =>
					client.call((c) =>
						c.events.update({
							params: { eventId: completion.id },
							payload: { properties: { remove: [], set: { timeSpent: 60 } } },
						}),
					),
				{ concurrency: 5 },
			);
			const explicit = yield* completionsFor(client, movie.entityId);
			expect(explicit).toHaveLength(30);
			for (const completion of explicit) {
				expect(completion.properties).not.toHaveProperty("completionKey");
			}
		}),
	);
});
