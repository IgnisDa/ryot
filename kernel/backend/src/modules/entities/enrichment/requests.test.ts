import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";

import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	makeRevisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import { redisKeys, RedisService } from "#platform/redis";
import { user } from "#schema/tables/auth";
import { entity } from "#schema/tables/entities";
import { makeRedisService } from "#testing/effect";

import type { EnrichmentRequestInput } from "./repository";
import { EnrichmentRequests } from "./requests";

const owner = { userId: UserId.make("owner"), token: "test-account-generation" };
const recipient = { userId: UserId.make("recipient"), token: "test-account-generation" };
const scheduledRetry = new Date("2030-01-01T00:00:00.000Z");

class RequestFixture extends Context.Service<
	RequestFixture,
	{
		readonly input: (id: string, patch?: Partial<EnrichmentRequestInput>) => EnrichmentRequestInput;
		readonly entityId: EntityId;
		readonly publications: Effect.Effect<ReadonlyArray<readonly [string, string]>>;
	}
>()("test/EnrichmentRequestsFixture") {}

const requestLayer = Layer.unwrap(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const installed = yield* installRevisionPackage(revisionPackage("enrichment", "one", "record"));
		const provider = yield* (yield* PluginRuntimeResolver).findProviderAvailableToUserByReference(
			owner.userId,
			{ slug: "enrichment-provider", owner: definitionOwner(installed.pluginId) },
		);
		assert(provider);
		const [row] = yield* session.run((db) =>
			db
				.insert(entity)
				.values({
					name: "Shared record",
					providerId: provider.id,
					entitySchemaSlug: "record",
					externalId: "shared-record",
					entitySchemaPluginId: installed.pluginId,
				})
				.returning({ id: entity.id }),
		);
		assert(row);
		const entityId = EntityId.make(row.id);
		const publications = yield* Ref.make<ReadonlyArray<readonly [string, string]>>([]);
		return EnrichmentRequests.layer.pipe(
			Layer.provide(
				Layer.succeed(
					RedisService,
					makeRedisService({
						publish: (channel, message) => {
							const publication: readonly [string, string] = [channel, message];
							return Ref.update(publications, (all) => [...all, publication]).pipe(Effect.as(1));
						},
					}),
				),
			),
			Layer.merge(
				Layer.succeed(RequestFixture, {
					entityId,
					publications: Ref.get(publications),
					input: (id, patch) => ({
						id,
						entityId,
						level: "full",
						language: null,
						requester: owner,
						scopeUserId: null,
						providerId: provider.id,
						operation: "population",
						entitySchemaSlug: "record",
						sourceContentGeneration: 1,
						externalId: "shared-record",
						pluginId: installed.pluginId,
						workflowName: "TestEnrichmentWorkflow",
						payload: { id, pin: "captured-authority" },
						...patch,
					}),
				}),
			),
		);
	}),
).pipe(
	Layer.provideMerge(makeRevisionDatabaseLayer(4)),
	Layer.provide(
		Layer.effectDiscard(
			Effect.gen(function* () {
				const now = yield* TestClock.withLive(DateTime.now);
				yield* TestClock.setTime(DateTime.toEpochMillis(now));
			}),
		),
	),
);

layer(requestLayer)((test) => {
	test.effect(
		"reads authoritative account generations and excludes missing or disabled accounts",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const session = yield* DatabaseSession;
				const id = UserId.make("account-read");
				yield* session.run((db) =>
					db
						.insert(user)
						.values({
							id,
							name: "Account",
							accountGeneration: "original",
							email: "account-read@example.test",
						}),
				);
				expect(yield* requests.account(id)).toEqual({ userId: id, token: "original" });
				yield* session.run((db) =>
					db.update(user).set({ accountGeneration: "replacement" }).where(eq(user.id, id)),
				);
				expect(yield* requests.account(id)).toEqual({ userId: id, token: "replacement" });
				yield* session.run((db) =>
					db.update(user).set({ disabledAt: scheduledRetry }).where(eq(user.id, id)),
				);
				expect(yield* requests.account(id)).toBeNull();
				expect(yield* requests.account(UserId.make("missing-account"))).toBeNull();
			}),
	);

	test.effect("replays an admitted ID without replacing its captured payload or state", () =>
		Effect.gen(function* () {
			const requests = yield* EnrichmentRequests;
			const fixture = yield* RequestFixture;
			const input = fixture.input("idempotent");
			const first = yield* requests.ensure(input);
			yield* requests.update(first.id, { attempt: 1, state: "running" });
			const replay = yield* requests.ensure({ ...input, payload: { pin: "changed-authority" } });
			expect(replay).toMatchObject({
				attempt: 1,
				id: first.id,
				state: "running",
				payload: input.payload,
				sequence: first.sequence,
			});
			assertExitFails(
				yield* Effect.exit(requests.ensure({ ...input, externalId: "other-record" })),
				new SandboxRunError({
					kind: "invalid-input",
					message: "Enrichment request identity was reused for another target",
				}),
			);
			expect(yield* requests.get(first.id)).toEqual(replay);
		}),
	);

	test.effect("rolls back request admission with its caller's pin transaction", () =>
		Effect.gen(function* () {
			const requests = yield* EnrichmentRequests;
			const fixture = yield* RequestFixture;
			const session = yield* DatabaseSession;
			const failure = new SandboxRunError({ kind: "invalid-input", message: "Admission rejected" });
			assertExitFails(
				yield* Effect.exit(
					session.transaction(
						Effect.gen(function* () {
							yield* requests.ensure(fixture.input("rolled-back-admission"));
							return yield* failure;
						}),
					),
				),
				failure,
			);
			expect(yield* requests.get("rolled-back-admission")).toBeNull();
		}),
	);

	test.effect("keeps failures and progress independent for users of one shared entity", () =>
		Effect.gen(function* () {
			const requests = yield* EnrichmentRequests;
			const fixture = yield* RequestFixture;
			const first = yield* requests.ensure(fixture.input("owner-failure"));
			const second = yield* requests.ensure(
				fixture.input("recipient-progress", { requester: recipient }),
			);
			yield* requests.update(first.id, {
				attempt: 1,
				state: "failed",
				failureKind: "missing-artifact",
			});
			yield* requests.update(second.id, { attempt: 1, state: "running" });
			expect(
				yield* requests.latest({
					requester: owner,
					operation: "population",
					entityId: fixture.entityId,
				}),
			).toMatchObject({ id: first.id, state: "failed" });
			expect(
				yield* requests.latest({
					requester: recipient,
					operation: "population",
					entityId: fixture.entityId,
				}),
			).toMatchObject({ id: second.id, state: "running", failureKind: null });
			expect(yield* fixture.publications).toContainEqual([
				redisKeys.entityUpdatedChannel,
				encodeEntityUpdatedMessage(fixture.entityId, "enrichment-updated", owner.userId),
			]);
			expect(yield* fixture.publications).toContainEqual([
				redisKeys.entityUpdatedChannel,
				encodeEntityUpdatedMessage(fixture.entityId, "enrichment-updated", recipient.userId),
			]);
		}),
	);

	test.effect(
		"separates operation, language and account generation when finding the latest request",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const population = yield* requests.ensure(fixture.input("latest-population"));
				for (const language of ["es", "fr"]) {
					yield* requests.ensure(
						fixture.input(`latest-${language}`, {
							language,
							level: null,
							operation: "translation",
						}),
					);
				}
				expect(
					yield* requests.latest({
						requester: owner,
						operation: "population",
						entityId: fixture.entityId,
					}),
				).toMatchObject({ id: population.id });
				expect(
					yield* requests.latest({
						language: "es",
						requester: owner,
						operation: "translation",
						entityId: fixture.entityId,
					}),
				).toMatchObject({ id: "latest-es" });
				expect(
					yield* requests.latest({
						operation: "population",
						entityId: fixture.entityId,
						requester: { ...owner, token: "reset-generation" },
					}),
				).toBeNull();
				assertExitFails(
					yield* Effect.exit(
						requests.ensure(
							fixture.input("stale-account", {
								requester: { ...owner, token: "stale-generation" },
							}),
						),
					),
					new SandboxRunError({
						kind: "infrastructure",
						message: "Mutation command belongs to a retired account",
					}),
				);
				expect(yield* requests.get("stale-account")).toBeNull();
				yield* (yield* DatabaseSession).run((db) =>
					db.update(entity).set({ contentGeneration: 2 }).where(eq(entity.id, fixture.entityId)),
				);
				expect(
					yield* requests.latest({
						language: "es",
						requester: owner,
						operation: "translation",
						entityId: fixture.entityId,
					}),
				).toBeNull();
				yield* requests.ensure(
					fixture.input("latest-current-content", {
						level: null,
						language: "es",
						operation: "translation",
						sourceContentGeneration: 2,
					}),
				);
				expect(
					yield* requests.latest({
						language: "es",
						requester: owner,
						operation: "translation",
						entityId: fixture.entityId,
					}),
				).toMatchObject({ id: "latest-current-content" });
			}),
	);

	test.effect("admits exactly one replacement for concurrent manual retries", () =>
		Effect.gen(function* () {
			const requests = yield* EnrichmentRequests;
			const fixture = yield* RequestFixture;
			const original = yield* requests.ensure(fixture.input("retry-original", { requester: null }));
			yield* requests.update(original.id, { state: "failed", failureKind: "script-failure" });
			const retries = yield* Effect.all(
				Array.from({ length: 8 }, (_, index) =>
					requests.ensure(
						fixture.input(`concurrent-retry-${index}`, { requester: null, retryOf: original.id }),
					),
				),
				{ concurrency: 8 },
			);
			expect(new Set(retries.map(({ id }) => id)).size).toBe(1);
			const [admitted] = retries;
			assert(admitted);
			expect(admitted).toMatchObject({ state: "queued", retryOf: original.id });
			for (let index = 0; index < 8; index++) {
				expect((yield* requests.get(`concurrent-retry-${index}`))?.id ?? null).toBe(
					admitted.id === `concurrent-retry-${index}` ? admitted.id : null,
				);
			}
			expect(yield* requests.get(original.id)).toMatchObject({ state: "failed" });
		}),
	);

	test.effect("attaches a rootless request once without changing its target on replay", () =>
		Effect.gen(function* () {
			const requests = yield* EnrichmentRequests;
			const fixture = yield* RequestFixture;
			const request = yield* requests.ensure(fixture.input("rootless", { entityId: null }));
			expect(request.entityId).toBeNull();
			expect(request.dispatchRoot).toBe(false);
			yield* requests.attachEntity(request.id, fixture.entityId);
			yield* requests.attachEntity(request.id, EntityId.make("unrelated-entity"));
			expect(yield* requests.get(request.id)).toMatchObject({
				dispatchRoot: false,
				entityId: fixture.entityId,
			});
		}),
	);

	test.effect(
		"clears replay payloads and retry schedules at every terminal state and ignores stale updates",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				for (const state of ["succeeded", "failed", "cancelled"] as const) {
					const request = yield* requests.ensure(fixture.input(`terminal-${state}`));
					yield* requests.update(request.id, {
						attempt: 2,
						state: "retrying",
						failureKind: "timeout",
						nextAttemptAt: scheduledRetry,
					});
					yield* requests.update(request.id, {
						state,
						failureKind: state === "succeeded" ? null : "timeout",
					});
					const terminal = yield* requests.get(request.id);
					expect(terminal).toMatchObject({ state, attempt: 2, payload: {}, nextAttemptAt: null });
					assert(terminal?.completedAt);
					yield* requests.update(request.id, { attempt: 3, state: "running" });
					yield* requests.update(request.id, { state: "failed", failureKind: "infrastructure" });
					expect(yield* requests.get(request.id)).toEqual(terminal);
				}
			}),
	);
});

layer(requestLayer)((test) => {
	test.effect(
		"prunes only old released terminal requests superseded for the same actor and target",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const now = yield* DateTime.now;
				yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.subtract(now, { days: 8 })));
				for (const id of ["superseded", "latest", "unreleased", "other-actor"]) {
					yield* requests.ensure(fixture.input(id, { externalId: id }));
					yield* requests.update(id, { state: "failed", failureKind: "timeout" });
					if (id !== "unreleased") {
						yield* requests.released(id);
					}
				}
				yield* requests.ensure(fixture.input("active", { externalId: "active" }));
				yield* TestClock.setTime(DateTime.toEpochMillis(now));
				yield* requests.ensure(fixture.input("recent", { externalId: "recent" }));
				yield* requests.update("recent", { state: "succeeded" });
				yield* requests.released("recent");
				for (const externalId of ["superseded", "unreleased", "active", "recent", "other-actor"]) {
					yield* requests.ensure(
						fixture.input(`${externalId}-replacement`, {
							externalId,
							requester: externalId === "other-actor" ? recipient : owner,
						}),
					);
				}
				yield* requests.prune();
				expect(yield* requests.get("superseded")).toBeNull();
				for (const id of ["latest", "unreleased", "active", "recent", "other-actor"]) {
					expect(yield* requests.get(id)).not.toBeNull();
				}
			}),
	);
});

layer(requestLayer)((test) => {
	test.effect("bounds recovery scans and rotates observed rows so later work is not starved", () =>
		Effect.gen(function* () {
			const requests = yield* EnrichmentRequests;
			const fixture = yield* RequestFixture;
			const ids = Array.from({ length: 105 }, (_, index) => `pending-${index}`);
			let lastObservedAt = DateTime.toEpochMillis(yield* DateTime.now);
			for (const id of ids) {
				const row = yield* requests.ensure(fixture.input(id, { requester: null }));
				lastObservedAt = Math.max(lastObservedAt, row.observedAt.getTime());
			}
			yield* requests.update("pending-1", { attempt: 1, state: "running" });
			yield* requests.update("pending-2", {
				attempt: 1,
				state: "retrying",
				nextAttemptAt: scheduledRetry,
			});
			const first = yield* requests.pending();
			expect(first.map(({ id }) => id)).toEqual(ids.slice(0, 100));
			yield* TestClock.setTime(lastObservedAt);
			yield* TestClock.adjust("1 second");
			for (const row of first) {
				yield* requests.observed(row.id);
			}
			const next = yield* requests.pending();
			expect(next).toHaveLength(100);
			expect(next.slice(0, 5).map(({ id }) => id)).toEqual(ids.slice(100));
			yield* requests.update("pending-100", { state: "succeeded" });
			expect((yield* requests.pending()).some(({ id }) => id === "pending-100")).toBe(true);
			yield* requests.released("pending-100");
			expect((yield* requests.pending()).some(({ id }) => id === "pending-100")).toBe(false);
			yield* requests.released("pending-101");
			expect((yield* requests.pending()).some(({ id }) => id === "pending-101")).toBe(true);
		}),
	);
});
