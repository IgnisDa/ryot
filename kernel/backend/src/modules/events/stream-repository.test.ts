import { assert, expect, layer } from "@effect/vitest";
import { EntityId, EventSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { DateTime, Effect, Layer } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";

import { EventStreamRepository, type StreamKey } from "./stream-repository";

const streamKey = (userId: UserId, entityId: EntityId, eventSchemaSlug = "review"): StreamKey => ({
	userId,
	entityId,
	eventSchemaPluginId: null,
	eventSchemaSlug: EventSchemaSlug.make(eventSchemaSlug),
});

const requestInput = (key: StreamKey) => ({
	key,
	outputProperties: ["rating"],
	accountToken: "stream-account-token",
	processorScriptId: "stream-processor",
	pluginRevisionId: "stream-plugin-revision",
	pluginPin: { revisionId: "stream-plugin-revision" },
});

const date = (value: string) => DateTime.toDateUtc(DateTime.makeUnsafe(value));

const seed = (suffix: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const userId = UserId.make(`stream-user-${suffix}`);
		const entityId = EntityId.make(`stream-entity-${suffix}`);
		const sessionEntityId = EntityId.make(`stream-session-${suffix}`);
		yield* session.run((db) =>
			db
				.insert(tables.user)
				.values({ id: userId, name: "Stream owner", email: `stream-${suffix}@example.test` }),
		);
		yield* session.run((db) =>
			db.insert(tables.entity).values([
				{ id: entityId, name: "Stream entity", entitySchemaSlug: "stream-test" },
				{ id: sessionEntityId, name: "Session entity", entitySchemaSlug: "stream-test" },
			]),
		);
		return { userId, entityId, sessionEntityId, key: streamKey(userId, entityId) };
	});

const databaseLayer = EventStreamRepository.layer.pipe(
	Layer.provideMerge(isolatedDatabaseLayer("event_stream_repository")),
);

layer(databaseLayer)((test) => {
	test.effect(
		"keeps the earliest dirty time and preserves completed checkpoints until new work",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* EventStreamRepository;
				const { key } = yield* seed("dirty-min");
				const id = yield* session.transaction(repository.request(requestInput(key)));
				const claim = yield* session.transaction(repository.claim(id, 0));
				assert(claim);
				expect(
					yield* session.transaction(
						repository.finish(id, claim.attempt, { cursor: "done" }, true),
					),
				).toBe(true);

				const later = date("2026-10-03T00:00:00.000Z");
				const earlier = date("2026-10-01T00:00:00.000Z");
				yield* session.transaction(repository.touch([{ ...key, occurredAt: later }]));
				const afterLater = yield* repository.get(id);
				assert(afterLater);
				expect(afterLater.status).toBe("queued");
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
			const { key } = yield* seed("stale-claim");
			const id = yield* session.transaction(repository.request(requestInput(key)));
			const claimed = yield* session.transaction(repository.claim(id, 0));
			assert(claimed);
			expect(claimed.status).toBe("running");
			const resumedClaim = yield* session.transaction(repository.claim(id, claimed.attempt));
			assert(resumedClaim);
			expect(resumedClaim.attempt).toBe(claimed.attempt);
			expect(
				yield* session.transaction(
					repository.currentClaim(id, claimed.attempt, claimed.streamRevision),
				),
			).toBe(true);

			yield* session.transaction(
				repository.touch([{ ...key, occurredAt: date("2026-10-02T00:00:00.000Z") }]),
			);
			const staleWork = yield* repository.get(id);
			assert(staleWork);
			expect(staleWork.dirtyFrom).toBeNull();
			expect(
				yield* session.transaction(
					repository.currentClaim(id, claimed.attempt, claimed.streamRevision),
				),
			).toBe(false);
			expect(
				yield* session.transaction(
					repository.finish(id, claimed.attempt, { cursor: "stale" }, true),
				),
			).toBe(false);
			expect(yield* session.transaction(repository.claim(id, 0))).toBeNull();
			const resumed = yield* session.transaction(repository.claim(id, claimed.attempt));
			assert(resumed);
			expect(resumed.attempt).toBe(claimed.attempt + 1);
			expect(
				yield* session.transaction(
					repository.currentClaim(id, resumed.attempt, resumed.streamRevision),
				),
			).toBe(true);
		}),
	);

	test.effect(
		"keeps owner writes in the active claim and makes request replay revision-aware",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* EventStreamRepository;
				const { key } = yield* seed("owner-write");
				const id = yield* session.transaction(repository.request(requestInput(key)));
				const claim = yield* session.transaction(repository.claim(id, 0));
				assert(claim);

				yield* session.transaction(
					Effect.gen(function* () {
						yield* repository.touch([{ ...key, occurredAt: date("2026-10-03T00:00:00.000Z") }], id);
						expect(
							yield* repository.finish(id, claim.attempt, { cursor: "owner-write" }, true),
						).toBe(true);
					}),
				);

				const completed = yield* repository.get(id);
				assert(completed);
				expect(completed.status).toBe("completed");
				expect(completed.streamRevision).toBe(claim.streamRevision + 1);
				expect(yield* session.transaction(repository.request(requestInput(key)))).toBe(id);
				expect((yield* repository.get(id))?.status).toBe("completed");

				yield* session.transaction(
					repository.touch([{ ...key, occurredAt: date("2026-10-04T00:00:00.000Z") }], id),
				);
				yield* session.transaction(repository.request(requestInput(key)));
				const replayed = yield* repository.get(id);
				assert(replayed);
				expect(replayed.status).toBe("queued");
				expect(replayed.dirtyFrom).toBeNull();
				expect(replayed.checkpoint).toBeNull();
			}),
	);

	test.effect(
		"invalidates streams that reference an entity as either event or session entity",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* EventStreamRepository;
				const { key, userId, entityId, sessionEntityId } = yield* seed("entity-invalidation");
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
				const claim = yield* session.transaction(repository.claim(id, 0));
				assert(claim);
				yield* session.transaction(repository.finish(id, claim.attempt, { cursor: "done" }, true));

				yield* session.transaction(repository.invalidateEntity(sessionEntityId));
				const invalidated = yield* repository.get(id);
				assert(invalidated);
				expect(invalidated.status).toBe("queued");
				expect(invalidated.streamRevision).toBe(claim.streamRevision + 1);
				expect(invalidated.dirtyFrom).toBeNull();
				expect(invalidated.checkpoint).toBeNull();
			}),
	);

	test.effect("requeues failed work when the same processor is requested again", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EventStreamRepository;
			const { key } = yield* seed("failed-request");
			const id = yield* session.transaction(repository.request(requestInput(key)));
			const claim = yield* session.transaction(repository.claim(id, 0));
			assert(claim);
			expect(
				yield* session.transaction(repository.fail(id, claim.attempt, "processor failed")),
			).toBe(true);
			expect((yield* repository.get(id))?.status).toBe("failed");
			yield* session.transaction(repository.request(requestInput(key)));
			const retried = yield* repository.get(id);
			assert(retried);
			expect(retried.status).toBe("queued");
			expect(retried.error).toBeNull();
		}),
	);

	test.effect(
		"discards a failed partial checkpoint when an external source touches the stream",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* EventStreamRepository;
				const { key } = yield* seed("failed-partial-checkpoint");
				const id = yield* session.transaction(repository.request(requestInput(key)));
				const firstClaim = yield* session.transaction(repository.claim(id, 0));
				assert(firstClaim);
				const checkpoint = { cursor: "partial" };
				expect(
					yield* session.transaction(repository.finish(id, firstClaim.attempt, checkpoint, false)),
				).toBe(true);

				const nextClaim = yield* session.transaction(repository.claim(id, firstClaim.attempt));
				assert(nextClaim);
				expect(nextClaim.checkpoint).toEqual(checkpoint);
				expect(
					yield* session.transaction(repository.fail(id, nextClaim.attempt, "processor failed")),
				).toBe(true);

				yield* session.transaction(
					repository.touch([{ ...key, occurredAt: date("2026-10-01T00:00:00.000Z") }]),
				);
				const queued = yield* repository.get(id);
				assert(queued);
				expect(queued.status).toBe("queued");
				expect(queued.checkpoint).toBeNull();
				expect(queued.dirtyFrom).toBeNull();

				const retried = yield* session.transaction(repository.claim(id, nextClaim.attempt));
				assert(retried);
				expect(retried.checkpoint).toBeNull();
			}),
	);
});
