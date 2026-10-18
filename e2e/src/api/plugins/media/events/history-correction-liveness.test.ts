import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { correctionInventoryFingerprintRecipe } from "@ryot-app/media-plugin/backend/contracts/history-correction-recipes";
import { mediaHistoryCorrectionStatusRecipe } from "@ryot-app/media-plugin/shared/history-correction-status";
import { showEpisodicKindConfig } from "@ryot-app/media-plugin/shared/lifecycle-expressions";
import {
	and,
	ascending,
	castNumber,
	castText,
	column,
	defineRecipe,
	eq,
	jsonPath,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/ryotql";
import { Effect, Result, Schema } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	waitForCreateEvents,
} from "~/fixtures/kernel";
import type { Client } from "~/fixtures/kernel/auth";
import { getApiClient } from "~/fixtures/kernel/contract-client";
import { invokeOperation } from "~/fixtures/kernel/operations";
import {
	createBuiltinMediaLifecycleFixture,
	logMediaActivity,
	mediaReferenceForEntity,
	seedShow,
	seedShowEpisode,
} from "~/fixtures/plugins/media";
import {
	historyCorrectionRetryRecipe,
	historyEventsFor,
	settledHistoryCorrection,
} from "~/fixtures/plugins/media/history-correction";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { nowIso } from "~/support/time";

const revisionsRecipe = defineRecipe(
	(input: { entityId: string; reference: PluginIdentityReference }) => {
		const scope = table("eventScope", "livenessScope");
		const checkpoint = table("event", "livenessCheckpoint");
		return {
			map: ({ scope: current, checkpoint: saved }) =>
				Result.succeed({ scope: current?.revision, checkpoint: saved?.sourceRevision }),
			queries: {
				scope: selectedOptionalRow(scope, {
					orderBy: [ascending(column(scope, "id"))],
					selection: { revision: selectedField(column(scope, "revision"), Schema.Int) },
					where: and(
						schemaOwnerPredicate(scope, "eventSchemaPluginId", input.reference),
						eq(column(scope, "entityId"), literal(input.entityId)),
					),
				}),
				checkpoint: selectedOptionalRow(checkpoint, {
					orderBy: [ascending(column(checkpoint, "id"))],
					selection: {
						sourceRevision: selectedField(
							castNumber(jsonPath(column(checkpoint, "properties"), "sourceRevision")),
							Schema.Int,
						),
					},
					where: and(
						schemaOwnerPredicate(checkpoint, "eventSchemaPluginId", input.reference),
						eq(column(checkpoint, "eventSchemaSlug"), literal("history-correction")),
						eq(
							castText(jsonPath(column(checkpoint, "properties"), "subjectEntityId")),
							literal(input.entityId),
						),
					),
				}),
			},
		};
	},
);

const completionsFor = (client: Client, entityId: string) =>
	historyEventsFor(client, entityId).pipe(
		Effect.map((rows) => rows.filter((row) => row.eventSchemaSlug === "complete")),
	);

const episodes = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		episodeNumber: index + 1,
		publishDate: "2020-01-01",
	}));

const logEveryEpisode = (
	client: Client,
	show: { show: { id: string }; episodes: readonly { id: string }[] },
) =>
	logMediaActivity(client, {
		submittedAt: nowIso(),
		submissionId: crypto.randomUUID(),
		entry: {
			kind: "episodes",
			parentEntityId: show.show.id,
			episodeEntityIds: show.episodes.map((episode) => episode.id),
			when: { kind: "date", finishedOn: "2026-01-01T12:00:00.000Z" },
		},
	});

const requireSettledStatus = (
	client: Client,
	reference: Effect.Success<ReturnType<typeof mediaReferenceForEntity>>,
	entityId: string,
) =>
	executeRyotQLRecipe(client, mediaHistoryCorrectionStatusRecipe({ entityId, reference })).pipe(
		Effect.tap((status) => Effect.sync(() => expect(status.status).toBe("settled"))),
	);

describe("Media history correction liveness", () => {
	it.live("settles every subject when history fans out across 60 subjects mid-run", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
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
			const responses = yield* Effect.all([create(movies.slice(0, 60)), create(movies.slice(60))], {
				concurrency: 2,
			});
			for (const response of responses) {
				yield* waitForCreateEvents(client, response);
			}
			yield* settledHistoryCorrection(client, userId);
			const reference = yield* mediaReferenceForEntity(client, movies[0]?.entityId ?? "");
			yield* Effect.forEach(
				movies,
				(movie) =>
					Effect.gen(function* () {
						expect(yield* completionsFor(client, movie.entityId)).toHaveLength(1);
						yield* requireSettledStatus(client, reference, movie.entityId);
					}),
				{ concurrency: 8 },
			);
		}),
	);

	it.live("serializes overlapping chains and a concurrent retry for one show", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const show = yield* seedShow(client, {
				properties: { productionStatus: "Ended" },
				seasons: [{ seasonNumber: 1, episodes: episodes(70) }],
			});
			const reference = yield* mediaReferenceForEntity(client, show.show.id);
			const submissionId = crypto.randomUUID();
			yield* Effect.all(
				[
					logEveryEpisode(client, show),
					invokeOperation(
						client,
						historyCorrectionRetryRecipe,
						{ submissionId, entityId: show.show.id },
						{ idempotencyKey: submissionId },
					),
				],
				{ concurrency: 2 },
			);
			yield* settledHistoryCorrection(client, userId);
			expect(yield* completionsFor(client, show.show.id)).toHaveLength(1);
			yield* requireSettledStatus(client, reference, show.show.id);
		}),
	);

	it.live("completes a multi-page snapshot while unrelated provider entities are written", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const show = yield* seedShow(client, {
				properties: { productionStatus: "Ended" },
				seasons: [{ seasonNumber: 1, episodes: episodes(60) }],
			});
			const reference = yield* mediaReferenceForEntity(client, show.show.id);
			yield* Effect.race(
				Effect.gen(function* () {
					yield* logEveryEpisode(client, show);
					yield* settledHistoryCorrection(client, userId);
				}),
				Effect.forever(createBuiltinMediaLifecycleFixture(client, { entitySchemaSlug: "movie" })),
			);
			expect(yield* completionsFor(client, show.show.id)).toHaveLength(1);
			yield* requireSettledStatus(client, reference, show.show.id);
		}),
	);

	it.live("predicts the source revision for batched audit writes", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const movie = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const reference = yield* mediaReferenceForEntity(client, movie.entityId);
			const created = yield* client.call((c) =>
				c.events.create({
					payload: Array.from({ length: 30 }, (_, index) => ({
						entityId: movie.entityId,
						properties: { progressPercent: 100 },
						eventSchemaSlug: movie.progressEventSchemaSlug,
						occurredAt: `2026-01-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
					})),
				}),
			);
			yield* waitForCreateEvents(client, created);
			yield* settledHistoryCorrection(client, userId);
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
			yield* settledHistoryCorrection(client, userId);
			const explicit = yield* completionsFor(client, movie.entityId);
			expect(explicit).toHaveLength(30);
			for (const completion of explicit) {
				expect(completion.properties).not.toHaveProperty("completionKey");
			}
			const revisions = yield* executeRyotQLRecipe(
				client,
				revisionsRecipe({ reference, entityId: movie.entityId }),
			);
			expect(revisions.checkpoint).toBe(revisions.scope);
		}),
	);

	it.live("changes the inventory fingerprint for each real change to the same show", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const show = yield* seedShow(client, {
				properties: { productionStatus: "Returning Series" },
				seasons: [{ seasonNumber: 1, episodes: episodes(60) }],
			});
			const subjectEntityId = show.show.id;
			const fingerprint = () =>
				executeRyotQLRecipe(
					client,
					correctionInventoryFingerprintRecipe({ subjectEntityId, config: showEpisodicKindConfig }),
				);
			const seasonId = show.seasons[0]?.id ?? "";
			const touch = (entityId: string) =>
				getApiClient(client.target).adminCall((c) =>
					c.testSupport.setEntityPopulatedAt({
						payload: { populatedAt: nowIso() },
						params: { entityId: EntityId.make(entityId) },
					}),
				);
			const base = yield* fingerprint();
			assertPresent(base, "Fingerprint missing");
			expect(base).toMatchObject({ total: 60, required: 60 });
			expect(yield* fingerprint()).toEqual(base);

			yield* touch(show.episodes[0]?.id ?? "");
			const afterEpisode = yield* fingerprint();
			assertPresent(afterEpisode, "Fingerprint missing");
			expect(afterEpisode.latestEpisode).not.toBe(base.latestEpisode);
			expect(afterEpisode.latestSeason).toBe(base.latestSeason);

			yield* touch(seasonId);
			const afterSeason = yield* fingerprint();
			assertPresent(afterSeason, "Fingerprint missing");
			expect(afterSeason.latestSeason).not.toBe(afterEpisode.latestSeason);
			expect(afterSeason.subjectUpdatedAt).toBe(afterEpisode.subjectUpdatedAt);

			yield* touch(subjectEntityId);
			const afterShow = yield* fingerprint();
			assertPresent(afterShow, "Fingerprint missing");
			expect(afterShow.subjectUpdatedAt).not.toBe(afterSeason.subjectUpdatedAt);

			const added = yield* seedShowEpisode(client, {
				seasonId,
				seasonNumber: 1,
				suffix: crypto.randomUUID(),
				episode: { episodeNumber: 61, publishDate: "2020-01-02" },
			});
			const afterAdd = yield* fingerprint();
			assertPresent(afterAdd, "Fingerprint missing");
			expect(afterAdd).toMatchObject({ total: 61, required: 61 });
			expect(afterAdd.latestLink).not.toBe(afterShow.latestLink);

			yield* getApiClient(client.target).adminCall((c) =>
				c.testSupport.deleteGlobalEntities({ payload: { ids: [EntityId.make(added.id)] } }),
			);
			const afterRemove = yield* fingerprint();
			assertPresent(afterRemove, "Fingerprint missing");
			expect(afterRemove).toMatchObject({ total: 60, required: 60 });
		}),
	);
});
