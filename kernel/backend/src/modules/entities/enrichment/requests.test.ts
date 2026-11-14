import { expect } from "bun:test";

import { SandboxRunError } from "@ryot-app/contract/errors";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, inArray } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { entity } from "#schema/tables/entities";
import { job } from "#schema/tables/jobs";

import type { EnrichmentRequestInput } from "./repository";
import { EnrichmentRequests } from "./requests";

const owner = UserId.make("owner");
const recipient = UserId.make("recipient");
const scheduledRetry = new Date("2030-01-01T00:00:00.000Z");

class RequestFixture extends Context.Service<
	RequestFixture,
	{
		readonly entityId: EntityId;
		readonly input: (id: string, patch?: Partial<EnrichmentRequestInput>) => EnrichmentRequestInput;
	}
>()("@ryot-app/kernel-backend/modules/entities/enrichment/requests.test/RequestFixture") {}

const requestLayer = Layer.unwrap(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const installed = yield* installRevisionPackage(revisionPackage("enrichment", "one", "record"));
		const provider = yield* (yield* PluginRuntimeResolver).findProviderAvailableToUserByReference(
			owner,
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
		return EnrichmentRequests.layer.pipe(
			Layer.merge(
				Layer.succeed(RequestFixture, {
					entityId,
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
						payload: { id, pin: "captured-authority" },
						...patch,
					}),
				}),
			),
		);
	}),
).pipe(
	Layer.provideMerge(revisionDatabaseLayer),
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
		"bounds requester admission without blocking replay",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const input = fixture.input("capacity-0", {
					populationMode: "refresh",
					populationPin: "capacity-pin",
					externalId: "capacity-record",
				});
				const admitted = yield* Effect.forEach(
					Array.from({ length: 50 }, (_, index) => index),
					(index) => requests.ensure({ ...input, id: `capacity-${index}` }),
					{ concurrency: 10 },
				);
				expect(admitted.filter((row) => row.joinedTo === null)).toHaveLength(1);
				expect((yield* requests.ensure(input)).id).toBe(input.id);
				assertExitFails(
					yield* Effect.exit(requests.ensure({ ...input, id: "capacity-overflow" })),
					new SandboxRunError({
						kind: "resource-unavailable",
						data: { code: "execution-limit" },
						message: "Provider population backlog is full",
					}),
				);
				expect(yield* requests.get("capacity-overflow")).toBeNull();
				for (const row of admitted) {
					yield* requests.update(row.id, { state: "cancelled" });
				}
			}),
		testTimeout,
	);
	test.effect(
		"fences timed-out attempts during backoff and after the next attempt starts",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const session = yield* DatabaseSession;
				const fixture = yield* RequestFixture;
				const row = yield* requests.ensure(
					fixture.input("attempt-fence", {
						populationMode: "refresh",
						populationPin: "attempt-pin",
						externalId: "attempt-record",
					}),
				);
				yield* requests.update(row.id, { attempt: 1, state: "running" });
				yield* session.transaction(requests.guardPopulation(row.id, 1));
				yield* requests.update(row.id, { state: "retrying" });
				expect(
					(yield* Effect.exit(session.transaction(requests.guardPopulation(row.id, 1))))._tag,
				).toBe("Failure");
				yield* requests.update(row.id, { attempt: 2, state: "running" });
				expect(
					(yield* Effect.exit(session.transaction(requests.guardPopulation(row.id, 1))))._tag,
				).toBe("Failure");
				yield* session.transaction(requests.guardPopulation(row.id, 2));
				yield* requests.update(row.id, { state: "succeeded" });
			}),
		testTimeout,
	);
	test.effect(
		"only the latest translation request can commit within one canonical generation and language",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const input = fixture.input("translation-old", {
					level: null,
					language: "es",
					operation: "translation",
				});
				yield* requests.ensure(input);
				expect(yield* requests.latestTranslation(input.id)).toBe(true);
				yield* requests.ensure({ ...input, requester: recipient, id: "translation-new" });
				expect(yield* requests.latestTranslation(input.id)).toBe(false);
				expect(yield* requests.latestTranslation("translation-new")).toBe(true);
				yield* requests.ensure({ ...input, language: "fr", id: "translation-other-language" });
				expect(yield* requests.latestTranslation("translation-new")).toBe(true);
			}),
		testTimeout,
	);
	test.effect(
		"shares compatible full refreshes across requesters but keeps their request identities",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const input = fixture.input("shared-refresh-owner", {
					populationMode: "refresh",
					populationPin: "shared-pin",
					externalId: "shared-refresh",
				});
				const first = yield* requests.ensure(input);
				const second = yield* requests.ensure({
					...input,
					requester: recipient,
					id: "shared-refresh-recipient",
				});
				expect(first.joinedTo).toBeNull();
				expect(second).toMatchObject({
					joinedTo: first.id,
					requesterUserId: recipient,
					id: "shared-refresh-recipient",
				});
				yield* requests.update(first.id, { state: "succeeded" });
				expect(
					yield* requests.latest({
						requester: recipient,
						operation: "population",
						entityId: fixture.entityId,
					}),
				).toMatchObject({ id: second.id, state: "succeeded" });
			}),
		testTimeout,
	);

	test.effect(
		"keeps a full refresh apart from base work, and fences writes after settlement",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const session = yield* DatabaseSession;
				const input = fixture.input("serial-base", {
					level: "base",
					populationMode: "ensure",
					populationPin: "serial-pin",
					externalId: "serial-record",
				});
				const base = yield* requests.ensure(input);
				const full = yield* requests.ensure({
					...input,
					level: "full",
					id: "serial-refresh",
					populationMode: "refresh",
				});
				expect(full.joinedTo).toBeNull();
				yield* requests.update(base.id, { attempt: 1, state: "running" });
				yield* session.transaction(requests.guardPopulation(base.id));
				yield* requests.update(base.id, { state: "succeeded" });
				assertExitFails(
					yield* Effect.exit(session.transaction(requests.guardPopulation(base.id))),
					new SandboxRunError({
						kind: "invalid-input",
						message: "Provider population no longer owns its writes",
					}),
				);
				yield* requests.update(full.id, { state: "succeeded" });
			}),
		testTimeout,
	);

	test.effect(
		"cancels the requester's unclaimed base work when full work for the same target is admitted",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const session = yield* DatabaseSession;
				const admitBase = Effect.fnUntraced(function* (
					name: string,
					status: "queued" | "running",
					requester: UserId = owner,
				) {
					const request = yield* requests.ensure(
						fixture.input(`${name}-base`, {
							requester,
							level: "base",
							externalId: name,
							populationPin: "supersede-pin",
						}),
					);
					yield* session.run((db) =>
						db
							.insert(job)
							.values({
								status,
								payload: {},
								attempts: 0,
								priority: 1,
								maxAttempts: 3,
								key: request.id,
								id: `job-${request.id}`,
								kind: "entity-population",
							}),
					);
					return request;
				});
				const admitFull = (name: string) =>
					requests.ensure(
						fixture.input(`${name}-full`, { externalId: name, populationPin: "supersede-pin" }),
					);
				const unclaimed = yield* admitBase("supersede-unclaimed", "queued");
				const claimed = yield* admitBase("supersede-claimed", "running");
				const shared = yield* admitBase("supersede-shared", "queued");
				yield* requests.ensure(
					fixture.input("supersede-shared-follower", {
						level: "base",
						requester: recipient,
						externalId: "supersede-shared",
						populationPin: "supersede-pin",
					}),
				);
				const foreign = yield* admitBase("supersede-foreign", "queued", recipient);
				for (const name of [
					"supersede-unclaimed",
					"supersede-claimed",
					"supersede-shared",
					"supersede-foreign",
				]) {
					yield* admitFull(name);
				}
				expect(yield* requests.get(unclaimed.id)).toMatchObject({ state: "cancelled" });
				for (const kept of [claimed, shared, foreign]) {
					expect(yield* requests.get(kept.id)).toMatchObject({ state: "queued" });
				}
				const jobs = yield* session.run((db) =>
					db
						.select({ key: job.key })
						.from(job)
						.where(inArray(job.key, [unclaimed.id, claimed.id, shared.id, foreign.id])),
				);
				expect(new Set(jobs.map(({ key }) => key))).toEqual(
					new Set([shared.id, claimed.id, foreign.id]),
				);
			}),
		testTimeout,
	);

	test.effect(
		"reuses a recent completed refresh only during the manual cooldown",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const input = fixture.input("cooldown-first", {
					populationMode: "refresh",
					populationPin: "cooldown-pin",
					externalId: "cooldown-record",
				});
				const first = yield* requests.ensure(input);
				yield* requests.update(first.id, { state: "succeeded" });
				const recent = yield* requests.ensure({ ...input, cooldown: true, id: "cooldown-second" });
				expect(recent.joinedTo).toBe(first.id);
				yield* TestClock.adjust("61 seconds");
				const fresh = yield* requests.ensure({ ...input, cooldown: true, id: "cooldown-third" });
				expect(fresh.joinedTo).toBeNull();
				yield* requests.update(fresh.id, { state: "cancelled" });
			}),
		testTimeout,
	);

	test.effect(
		"does not share work across pinned revisions or private scopes",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const input = fixture.input("pin-first", {
					populationPin: "pin-one",
					externalId: "pin-record",
					populationMode: "refresh",
				});
				for (const request of [
					input,
					{ ...input, id: "pin-second", populationPin: "pin-two" },
					{ ...input, id: "pin-private", scopeUserId: owner },
				]) {
					const row = yield* requests.ensure(request);
					expect(row.joinedTo).toBeNull();
					yield* requests.update(row.id, { state: "cancelled" });
				}
			}),
		testTimeout,
	);

	test.effect(
		"reads an account and excludes missing or disabled ones",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const session = yield* DatabaseSession;
				const id = UserId.make("account-read");
				yield* session.run((db) =>
					db.insert(user).values({ id, name: "Account", email: "account-read@example.test" }),
				);
				expect(yield* requests.account(id)).toEqual(id);
				yield* session.run((db) =>
					db.update(user).set({ disabledAt: scheduledRetry }).where(eq(user.id, id)),
				);
				expect(yield* requests.account(id)).toBeNull();
				expect(yield* requests.account(UserId.make("missing-account"))).toBeNull();
			}),
		testTimeout,
	);

	test.effect(
		"replays an admitted ID without replacing its captured payload or state",
		() =>
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
		testTimeout,
	);

	test.effect(
		"rolls back request admission with its caller's pin transaction",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const session = yield* DatabaseSession;
				const failure = new SandboxRunError({
					kind: "invalid-input",
					message: "Admission rejected",
				});
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
		testTimeout,
	);

	test.effect(
		"keeps failures and progress independent for users of one shared entity",
		() =>
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
			}),
		testTimeout,
	);

	test.effect(
		"separates operation and language when finding the latest request",
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
		testTimeout,
	);

	test.effect(
		"admits exactly one replacement for concurrent manual retries",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const original = yield* requests.ensure(
					fixture.input("retry-original", { requester: null }),
				);
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
		testTimeout,
	);

	test.effect(
		"attaches a rootless request once without changing its target on replay",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const request = yield* requests.ensure(fixture.input("rootless", { entityId: null }));
				expect(request.entityId).toBeNull();
				yield* requests.attachEntity(request.id, fixture.entityId);
				yield* requests.attachEntity(request.id, EntityId.make("unrelated-entity"));
				expect(yield* requests.get(request.id)).toMatchObject({ entityId: fixture.entityId });
			}),
		testTimeout,
	);

	test.effect(
		"clears replay payloads at every terminal state and ignores stale updates",
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
					});
					yield* requests.update(request.id, {
						state,
						failureKind: state === "succeeded" ? null : "timeout",
					});
					const terminal = yield* requests.get(request.id);
					expect(terminal).toMatchObject({ state, attempt: 2, payload: {} });
					assert(terminal?.completedAt);
					yield* requests.update(request.id, { attempt: 3, state: "running" });
					yield* requests.update(request.id, { state: "failed", failureKind: "infrastructure" });
					expect(yield* requests.get(request.id)).toEqual(terminal);
				}
			}),
		testTimeout,
	);
});

layer(requestLayer)((test) => {
	test.effect(
		"prunes only old terminal requests superseded for the same actor and target",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const now = yield* DateTime.now;
				yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.subtract(now, { days: 8 })));
				for (const id of ["superseded", "latest", "other-actor"]) {
					yield* requests.ensure(fixture.input(id, { externalId: id }));
					yield* requests.update(id, { state: "failed", failureKind: "timeout" });
				}
				yield* requests.ensure(fixture.input("active", { externalId: "active" }));
				yield* TestClock.setTime(DateTime.toEpochMillis(now));
				yield* requests.ensure(fixture.input("recent", { externalId: "recent" }));
				yield* requests.update("recent", { state: "succeeded" });
				for (const externalId of ["superseded", "active", "recent", "other-actor"]) {
					yield* requests.ensure(
						fixture.input(`${externalId}-replacement`, {
							externalId,
							requester: externalId === "other-actor" ? recipient : owner,
						}),
					);
				}
				yield* requests.prune();
				expect(yield* requests.get("superseded")).toBeNull();
				for (const id of ["latest", "active", "recent", "other-actor"]) {
					expect(yield* requests.get(id)).not.toBeNull();
				}
			}),
		testTimeout,
	);
});

layer(requestLayer)((test) => {
	test.effect(
		"fails active requests whose job is gone, with their followers, and leaves queued ones",
		() =>
			Effect.gen(function* () {
				const requests = yield* EnrichmentRequests;
				const fixture = yield* RequestFixture;
				const session = yield* DatabaseSession;
				const lost = yield* requests.ensure(
					fixture.input("lost", {
						populationPin: "lost-pin",
						externalId: "lost-record",
						populationMode: "refresh",
					}),
				);
				const follower = yield* requests.ensure(
					fixture.input("lost-follower", {
						requester: recipient,
						populationPin: "lost-pin",
						externalId: "lost-record",
						populationMode: "refresh",
					}),
				);
				expect(follower.joinedTo).toBe(lost.id);
				const queued = yield* requests.ensure(fixture.input("queued", { externalId: "queued" }));
				yield* session.run((db) =>
					db
						.insert(job)
						.values({
							payload: {},
							attempts: 0,
							priority: 0,
							key: queued.id,
							maxAttempts: 3,
							status: "queued",
							id: `job-${queued.id}`,
							kind: "entity-population",
						}),
				);
				yield* requests.failOrphaned(100);
				expect(yield* requests.get(lost.id)).toMatchObject({ state: "failed" });
				expect(yield* requests.get(follower.id)).toMatchObject({ state: "failed" });
				expect(yield* requests.get(queued.id)).toMatchObject({ state: "queued" });
			}),
		testTimeout,
	);
});
