import { assert, expect, layer } from "@effect/vitest";
import { EntityId, EventSchemaSlug, PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Layer } from "effect";

import { testPluginPackageId } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { EventStreamRepository } from "./stream-repository";
import { streamState } from "./stream-repository.test-support";

const binding = {
	configRevisionId: "config",
	accountToken: "stream-account-token",
	processorScriptId: "stream-processor",
	pluginRevisionId: "stream-plugin-revision",
	pluginPin: { configRevisionId: "config", revisionId: "stream-plugin-revision" },
};

const outputSchema = {
	unknownKeys: "strict" as const,
	fields: { rating: { label: "rating", description: "rating", type: "number" as const } },
};

const date = (value: string) => DateTime.toDateUtc(DateTime.makeUnsafe(value));

const seed = (suffix: string, count = 1) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const streams = yield* EventStreamRepository;
		const userId = UserId.make(`stream-user-${suffix}`);
		const pluginId = PluginId.make(`stream-plugin-${suffix}`);
		const sessionEntityId = EntityId.make(`stream-session-${suffix}`);
		const entityIds = Array.from({ length: count }, (_, index) =>
			EntityId.make(`stream-entity-${suffix}-${String(index).padStart(4, "0")}`),
		);
		yield* session.run((db) =>
			db
				.insert(tables.user)
				.values({
					id: userId,
					name: "Stream owner",
					email: `stream-${suffix}@example.test`,
					accountGeneration: "stream-account-token",
				}),
		);
		yield* session.run((db) =>
			db
				.insert(tables.plugin)
				.values({ id: pluginId, status: "inactive", packageId: testPluginPackageId() }),
		);
		yield* session.run((db) =>
			db
				.insert(tables.entity)
				.values(
					[...entityIds, sessionEntityId].map((id) => ({
						id,
						name: id,
						entitySchemaSlug: "stream-test",
					})),
				),
		);
		const keys = entityIds.map((entityId) => ({
			userId,
			entityId,
			eventSchemaPluginId: pluginId,
			eventSchemaSlug: EventSchemaSlug.make("review"),
		}));
		const created = yield* session.transaction(streams.ensureStreams(keys));
		const scope = { userId, eventSchemaSlug: "review", eventSchemaPluginId: pluginId };
		const declaration = { ...scope, entitySchemaSlug: "stream-test" };
		const bind = (input: { after?: string; limit?: number; pluginRevisionId?: string } = {}) =>
			session.transaction(
				streams.bind({
					declaration,
					outputSchema,
					limit: input.limit ?? count,
					...(input.after === undefined ? {} : { after: input.after }),
					binding: {
						...binding,
						pluginRevisionId: input.pluginRevisionId ?? binding.pluginRevisionId,
					},
				}),
			);
		const job = (id: string, status: "failed" | "queued" | "running" | "succeeded" = "running") =>
			session.run((db) =>
				db
					.insert(tables.backgroundWork)
					.values({
						id,
						userId,
						status,
						key: id,
						pluginId,
						payload: {},
						scope: "review",
						purpose: "event-projection",
						inputHash: "test-input-hash",
						accountToken: "stream-account-token",
					}),
			);
		const claim = (jobId: string, limit = 100) =>
			session.transaction(streams.claim({ jobId, scope, limit, binding }));
		const settle = (jobId: string, status: "failed" | "succeeded") =>
			session.run((db) =>
				db.update(tables.backgroundWork).set({ status }).where(eq(tables.backgroundWork.id, jobId)),
			);
		const complete = (jobId: string, id: string) =>
			session.transaction(
				streams.finish(jobId, [{ id, done: true, revision: 0, checkpoint: { cursor: "done" } }]),
			);
		return {
			job,
			bind,
			scope,
			claim,
			settle,
			complete,
			sessionEntityId,
			ids: created.map(({ id }) => id),
			keyOf: (id: string) =>
				keys.find((key) => created.some((row) => row.id === id && row.entityId === key.entityId)),
		};
	});

layer(
	EventStreamRepository.layer.pipe(
		Layer.provideMerge(isolatedDatabaseLayer("event_stream_repository")),
	),
)((test) => {
	test.effect("binds every stream of a declaration in keyset pages and rebinds only changes", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const fixture = yield* seed("bind-pages", 5);
			const first = yield* fixture.bind({ limit: 2 });
			const [, firstLast] = first;
			assert(firstLast);
			const second = yield* fixture.bind({ limit: 2, after: firstLast });
			const [, secondLast] = second;
			assert(secondLast);
			const third = yield* fixture.bind({ limit: 2, after: secondLast });
			expect([...first, ...second, ...third]).toEqual(fixture.ids);
			expect(yield* fixture.bind()).toEqual([]);

			const [id] = fixture.ids;
			assert(id);
			yield* fixture.job("bind-job");
			yield* session.run((db) =>
				db
					.update(tables.eventStreamWork)
					.set({ completedRevision: 0, currentJobId: "bind-job", checkpoint: { cursor: "done" } })
					.where(eq(tables.eventStreamWork.id, id)),
			);
			expect(yield* fixture.bind({ pluginRevisionId: "next-revision" })).toEqual(fixture.ids);
			expect(yield* streamState(id)).toMatchObject({
				checkpoint: null,
				currentJobId: null,
				completedRevision: null,
				pluginRevisionId: "next-revision",
			});
		}),
	);

	test.effect(
		"claims dirty streams in batches and retries failed batches one stream at a time",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const streams = yield* EventStreamRepository;
				const fixture = yield* seed("claims", 3);
				const [sticky, retried, healthy] = fixture.ids;
				assert(sticky && retried && healthy);
				yield* fixture.bind();
				yield* fixture.job("claim-first");
				const first = yield* fixture.claim("claim-first", 2);
				expect(first.map(({ id }) => id)).toEqual([sticky, retried]);
				expect(first[0]).toMatchObject({ revision: 0, dirtyFrom: null, checkpoint: null });
				yield* fixture.settle("claim-first", "failed");

				yield* fixture.job("claim-alone");
				expect((yield* fixture.claim("claim-alone")).map(({ id }) => id)).toEqual([sticky]);
				yield* fixture.settle("claim-alone", "failed");

				yield* fixture.job("claim-retry");
				expect((yield* fixture.claim("claim-retry")).map(({ id }) => id)).toEqual([retried]);
				yield* fixture.complete("claim-retry", retried);
				yield* fixture.settle("claim-retry", "succeeded");

				yield* fixture.job("claim-healthy");
				expect((yield* fixture.claim("claim-healthy")).map(({ id }) => id)).toEqual([healthy]);
				expect(yield* streams.claimable(fixture.scope, binding)).toBe(true);
				yield* fixture.complete("claim-healthy", healthy);
				yield* fixture.settle("claim-healthy", "succeeded");

				expect(yield* streams.claimable(fixture.scope, binding)).toBe(false);
				expect((yield* streamState(sticky))?.status).toBe("failed");
				yield* session.transaction(streams.retry(sticky));
				expect(yield* streams.claimable(fixture.scope, binding)).toBe(true);
			}),
	);

	test.effect("publishes only current claims and keeps partial streams dirty", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const streams = yield* EventStreamRepository;
			const fixture = yield* seed("finish", 3);
			yield* fixture.bind();
			yield* fixture.job("finish-job");
			const claimed = yield* fixture.claim("finish-job");
			const [done, partial, stale] = claimed;
			assert(done && partial && stale);
			const staleKey = fixture.keyOf(stale.id);
			assert(staleKey);
			yield* session.transaction(
				streams.touch([{ ...staleKey, occurredAt: date("2026-10-02T00:00:00.000Z") }]),
			);
			const live = yield* session.transaction(
				streams.currentClaims(
					"finish-job",
					claimed.map(({ id, revision }) => ({ id, revision })),
				),
			);
			expect(live).toEqual([done.id, partial.id]);
			yield* session.transaction(
				streams.finish("finish-job", [
					{ done: true, id: done.id, revision: done.revision, checkpoint: { cursor: "done" } },
					{
						done: false,
						id: partial.id,
						revision: partial.revision,
						checkpoint: { cursor: "partial" },
					},
				]),
			);
			expect(yield* streamState(done.id)).toMatchObject({
				dirtyFrom: null,
				completedRevision: 0,
				checkpoint: { cursor: "done" },
			});
			expect(yield* streamState(partial.id)).toMatchObject({
				completedRevision: null,
				currentJobId: "finish-job",
				checkpoint: { cursor: "partial" },
			});
			expect(yield* streamState(stale.id)).toMatchObject({
				checkpoint: null,
				streamRevision: 1,
				currentJobId: null,
			});
			yield* fixture.settle("finish-job", "succeeded");
			expect(
				yield* session.transaction(
					streams.currentClaims("finish-job", [{ id: partial.id, revision: partial.revision }]),
				),
			).toEqual([]);
			yield* fixture.job("finish-next");
			expect((yield* fixture.claim("finish-next")).map(({ id }) => id)).toEqual([
				partial.id,
				stale.id,
			]);
		}),
	);

	test.effect(
		"keeps the earliest dirty time and preserves completed checkpoints until new work",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const streams = yield* EventStreamRepository;
				const fixture = yield* seed("dirty-min");
				const [id] = fixture.ids;
				assert(id);
				const key = fixture.keyOf(id);
				assert(key);
				yield* fixture.bind();
				yield* fixture.job("dirty-job");
				yield* fixture.claim("dirty-job");
				yield* fixture.complete("dirty-job", id);

				const later = date("2026-10-03T00:00:00.000Z");
				const earlier = date("2026-10-01T00:00:00.000Z");
				yield* session.transaction(streams.touch([{ ...key, occurredAt: later }]));
				expect(yield* streamState(id)).toMatchObject({
					dirtyFrom: later,
					currentJobId: null,
					checkpoint: { cursor: "done" },
				});

				yield* session.transaction(streams.touch([{ ...key, occurredAt: earlier }]));
				expect(yield* streamState(id)).toMatchObject({ checkpoint: null, dirtyFrom: earlier });
			}),
	);

	test.effect(
		"invalidates streams that reference an entity as either event or session entity",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const streams = yield* EventStreamRepository;
				const fixture = yield* seed("entity-invalidation");
				const [id] = fixture.ids;
				assert(id);
				const key = fixture.keyOf(id);
				assert(key);
				yield* session.run((db) =>
					db
						.insert(tables.event)
						.values({
							...key,
							id: "stream-invalidation-event",
							sessionEntityId: fixture.sessionEntityId,
							occurredAt: date("2026-10-01T00:00:00.000Z"),
						}),
				);
				yield* fixture.bind();
				yield* fixture.job("invalidation-job");
				yield* fixture.claim("invalidation-job");
				yield* fixture.complete("invalidation-job", id);

				yield* session.transaction(streams.invalidateEntity(fixture.sessionEntityId));
				expect(yield* streamState(id)).toMatchObject({
					dirtyFrom: null,
					checkpoint: null,
					streamRevision: 1,
					currentJobId: null,
					completedRevision: null,
				});
			}),
	);
});
