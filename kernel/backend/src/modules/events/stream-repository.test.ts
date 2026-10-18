import { assert, expect, layer } from "@effect/vitest";
import { EntityId, EventSchemaSlug, PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { DateTime, Effect, Layer } from "effect";

import { testPluginPackageId } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { eventStreamId, EventStreamRepository, type StreamKey } from "./stream-repository";

const streamKey = (userId: UserId, entityId: EntityId, eventSchemaSlug = "review"): StreamKey => ({
	userId,
	entityId,
	eventSchemaPluginId: null,
	eventSchemaSlug: EventSchemaSlug.make(eventSchemaSlug),
});

const requestInput = (key: StreamKey) => ({
	key,
	accountToken: "stream-account-token",
	processorScriptId: "stream-processor",
	pluginRevisionId: "stream-plugin-revision",
	pluginPin: { revisionId: "stream-plugin-revision" },
	outputSchema: {
		unknownKeys: "strict" as const,
		fields: { rating: { label: "rating", description: "rating", type: "number" as const } },
	},
});

const date = (value: string) => DateTime.toDateUtc(DateTime.makeUnsafe(value));

const seed = (suffix: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const userId = UserId.make(`stream-user-${suffix}`);
		const entityId = EntityId.make(`stream-entity-${suffix}`);
		const sessionEntityId = EntityId.make(`stream-session-${suffix}`);
		const pluginId = PluginId.make(`stream-plugin-${suffix}`);
		yield* session.run((db) =>
			db
				.insert(tables.user)
				.values({ id: userId, name: "Stream owner", email: `stream-${suffix}@example.test` }),
		);
		yield* session.run((db) =>
			db
				.insert(tables.plugin)
				.values({ id: pluginId, status: "inactive", packageId: testPluginPackageId() }),
		);
		yield* session.run((db) =>
			db.insert(tables.entity).values([
				{ id: entityId, name: "Stream entity", entitySchemaSlug: "stream-test" },
				{ id: sessionEntityId, name: "Session entity", entitySchemaSlug: "stream-test" },
			]),
		);
		return { userId, pluginId, entityId, sessionEntityId, key: streamKey(userId, entityId) };
	});

const reserveJob = (id: string, userId: UserId, pluginId: PluginId, jobId: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const repository = yield* EventStreamRepository;
		return yield* session.transaction(
			Effect.gen(function* () {
				yield* session.run((db) =>
					db
						.insert(tables.backgroundWork)
						.values({
							userId,
							pluginId,
							id: jobId,
							scope: id,
							key: jobId,
							payload: {},
							status: "running",
							purpose: "event-projection",
							inputHash: "test-input-hash",
							accountToken: "stream-account-token",
						}),
				);
				const state = yield* repository.prepare(id);
				assert(state);
				yield* repository.reserve(id, jobId);
				return state;
			}),
		);
	});

const databaseLayer = EventStreamRepository.layer.pipe(
	Layer.provideMerge(isolatedDatabaseLayer("event_stream_repository")),
);

layer(
	EventStreamRepository.layer.pipe(
		Layer.provideMerge(isolatedDatabaseLayer("event_stream_candidate_batch")),
	),
)((test) => {
	test.effect("selects up to 500 pending streams per default dispatch batch", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EventStreamRepository;
			const { key, ...work } = requestInput((yield* seed("candidate-batch")).key);
			const streams = Array.from({ length: 501 }, (_, index) => {
				const stream = { ...key, eventSchemaSlug: EventSchemaSlug.make(`batch-${index}`) };
				return { ...stream, id: eventStreamId(stream) };
			}).sort((left, right) => left.id.localeCompare(right.id));
			yield* session.run((db) => db.insert(tables.eventStream).values(streams));
			yield* session.run((db) =>
				db.insert(tables.eventStreamWork).values(streams.map(({ id }) => ({ ...work, id }))),
			);

			expect((yield* repository.listCandidates()).map(({ id }) => id)).toEqual(
				streams.slice(0, 500).map(({ id }) => id),
			);
		}),
	);
});

layer(databaseLayer)((test) => {
	test.effect("rebuilds completed projections when only their configuration pin changes", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EventStreamRepository;
			const { key, userId, pluginId } = yield* seed("configuration-binding");
			const request = requestInput(key);
			const id = yield* session.transaction(
				repository.request({
					...request,
					pluginPin: { ...request.pluginPin, configRevisionId: "first" },
				}),
			);
			const jobId = `${id}-configuration-job`;
			const prepared = yield* reserveJob(id, userId, pluginId, jobId);
			expect(prepared.step).toBe(0);
			expect(
				yield* session.transaction(
					repository.finish(id, jobId, prepared.streamRevision, { cursor: "complete" }, true),
				),
			).toBe(true);
			yield* session.transaction(
				repository.request({
					...request,
					pluginPin: { ...request.pluginPin, configRevisionId: "second" },
				}),
			);
			const pending = yield* repository.get(id);
			assert(pending);
			expect(pending.checkpoint).toBeNull();
			expect(pending.completedRevision).toBeNull();
			expect(pending.currentJobId).toBeNull();
			expect(pending.streamRevision).toBe(prepared.streamRevision);
			expect(pending.pluginPin).toEqual({ ...request.pluginPin, configRevisionId: "second" });
		}),
	);

	test.effect(
		"keeps the earliest dirty time and preserves completed checkpoints until new work",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* EventStreamRepository;
				const { key, userId, pluginId } = yield* seed("dirty-min");
				const id = yield* session.transaction(repository.request(requestInput(key)));
				const jobId = `${id}-dirty-job`;
				const prepared = yield* reserveJob(id, userId, pluginId, jobId);
				expect(
					yield* session.transaction(
						repository.finish(id, jobId, prepared.streamRevision, { cursor: "done" }, true),
					),
				).toBe(true);

				const later = date("2026-10-03T00:00:00.000Z");
				const earlier = date("2026-10-01T00:00:00.000Z");
				yield* session.transaction(repository.touch([{ ...key, occurredAt: later }]));
				const afterLater = yield* repository.get(id);
				assert(afterLater);
				expect(afterLater.currentJobId).toBeNull();
				expect(afterLater.dirtyFrom).toEqual(later);
				expect(afterLater.checkpoint).toEqual({ cursor: "done" });

				yield* session.transaction(repository.touch([{ ...key, occurredAt: earlier }]));
				const afterEarlier = yield* repository.get(id);
				assert(afterEarlier);
				expect(afterEarlier.dirtyFrom).toEqual(earlier);
				expect(afterEarlier.checkpoint).toBeNull();
			}),
	);

	test.effect("invalidates stale claims after a stream revision changes", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EventStreamRepository;
			const { key, userId, pluginId } = yield* seed("stale-claim");
			const id = yield* session.transaction(repository.request(requestInput(key)));
			const jobId = `${id}-stale-job`;
			const prepared = yield* reserveJob(id, userId, pluginId, jobId);
			const running = yield* repository.get(id);
			assert(running);
			expect(running.status).toBe("running");
			expect(running.currentJobId).toBe(jobId);
			expect(
				yield* session.transaction(repository.currentClaim(id, jobId, prepared.streamRevision)),
			).toBe(true);

			yield* session.transaction(
				repository.touch([{ ...key, occurredAt: date("2026-10-02T00:00:00.000Z") }]),
			);
			const staleWork = yield* repository.get(id);
			assert(staleWork);
			expect(staleWork.currentJobId).toBeNull();
			expect(staleWork.dirtyFrom).toBeNull();
			expect(
				yield* session.transaction(repository.currentClaim(id, jobId, prepared.streamRevision)),
			).toBe(false);
			expect(
				yield* session.transaction(
					repository.finish(id, jobId, prepared.streamRevision, { cursor: "stale" }, true),
				),
			).toBe(false);
		}),
	);

	test.effect("preserves completed work on request replay until a source write queues it", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EventStreamRepository;
			const { key, userId, pluginId } = yield* seed("completed-request-replay");
			const id = yield* session.transaction(repository.request(requestInput(key)));
			const jobId = `${id}-completed-job`;
			const prepared = yield* reserveJob(id, userId, pluginId, jobId);

			yield* session.transaction(
				repository.finish(id, jobId, prepared.streamRevision, { cursor: "completed" }, true),
			);

			const completed = yield* repository.get(id);
			assert(completed);
			expect(completed.completedRevision).toBe(prepared.streamRevision);
			expect(completed.streamRevision).toBe(prepared.streamRevision);
			expect(yield* session.transaction(repository.request(requestInput(key)))).toBe(id);
			const unchanged = yield* repository.get(id);
			assert(unchanged);
			expect(unchanged.completedRevision).toBe(prepared.streamRevision);
			expect(unchanged.checkpoint).toEqual({ cursor: "completed" });

			yield* session.transaction(
				repository.touch([{ ...key, occurredAt: date("2026-10-04T00:00:00.000Z") }]),
			);
			yield* session.transaction(repository.request(requestInput(key)));
			const replayed = yield* repository.get(id);
			assert(replayed);
			expect(replayed.completedRevision).toBe(prepared.streamRevision);
			expect(replayed.streamRevision).toBe(prepared.streamRevision + 1);
			expect(replayed.dirtyFrom).toEqual(date("2026-10-04T00:00:00.000Z"));
			expect(replayed.checkpoint).toEqual({ cursor: "completed" });
			expect(replayed.currentJobId).toBeNull();
		}),
	);

	test.effect(
		"invalidates streams that reference an entity as either event or session entity",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* EventStreamRepository;
				const { key, userId, pluginId, entityId, sessionEntityId } =
					yield* seed("entity-invalidation");
				yield* session.run((db) =>
					db
						.insert(tables.event)
						.values({
							userId,
							entityId,
							sessionEntityId,
							eventSchemaPluginId: null,
							id: "stream-invalidation-event",
							eventSchemaSlug: key.eventSchemaSlug,
							occurredAt: date("2026-10-01T00:00:00.000Z"),
						}),
				);
				const id = yield* session.transaction(repository.request(requestInput(key)));
				const jobId = `${id}-invalidation-job`;
				const prepared = yield* reserveJob(id, userId, pluginId, jobId);
				yield* session.transaction(
					repository.finish(id, jobId, prepared.streamRevision, { cursor: "done" }, true),
				);

				yield* session.transaction(repository.invalidateEntity(sessionEntityId));
				const invalidated = yield* repository.get(id);
				assert(invalidated);
				expect(invalidated.completedRevision).toBe(prepared.streamRevision);
				expect(invalidated.streamRevision).toBe(prepared.streamRevision + 1);
				expect(invalidated.dirtyFrom).toBeNull();
				expect(invalidated.checkpoint).toBeNull();
				expect(invalidated.currentJobId).toBeNull();
			}),
	);

	test.effect(
		"preserves partial checkpoints for the next page and clears them on a source touch",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* EventStreamRepository;
				const { key, userId, pluginId } = yield* seed("partial-checkpoint");
				const id = yield* session.transaction(repository.request(requestInput(key)));
				const firstJobId = `${id}-partial-job-1`;
				const prepared = yield* reserveJob(id, userId, pluginId, firstJobId);
				const checkpoint = { cursor: "partial" };
				expect(
					yield* session.transaction(
						repository.finish(id, firstJobId, prepared.streamRevision, checkpoint, false),
					),
				).toBe(true);

				const partial = yield* repository.get(id);
				assert(partial);
				expect(partial.currentJobId).toBeNull();
				expect(partial.checkpoint).toEqual(checkpoint);
				expect(partial.completedRevision).toBeNull();

				const nextJobId = `${id}-partial-job-2`;
				yield* reserveJob(id, userId, pluginId, nextJobId);
				const next = yield* repository.get(id);
				assert(next);
				expect(next.currentJobId).toBe(nextJobId);
				expect(next.status).toBe("running");
				expect(next.checkpoint).toEqual(checkpoint);

				yield* session.transaction(
					repository.touch([{ ...key, occurredAt: date("2026-10-01T00:00:00.000Z") }]),
				);
				const invalidated = yield* repository.get(id);
				assert(invalidated);
				expect(invalidated.currentJobId).toBeNull();
				expect(invalidated.checkpoint).toBeNull();
				expect(invalidated.dirtyFrom).toBeNull();
			}),
	);
});
