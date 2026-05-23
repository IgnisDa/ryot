import { expect, it } from "@effect/vitest";
import {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Clock, Duration, Effect, Layer } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import { databaseLayer, makeRedisService } from "#lib/test-utils/effect";
import { EntitiesService } from "#modules/entities/service";
import { TranslationsService, type RequestFillInput } from "#modules/entity-translation/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EntityInterestProgression } from "./progression";
import { EntityInterestStore } from "./store";

const entityId = EntityId.make("entity-1");
const entity = {
	id: entityId,
	name: "Book",
	externalId: "book-1",
	properties: { title: "Book" },
	createdAt: "2026-08-14T00:00:00.000Z",
	updatedAt: "2026-08-14T00:00:00.000Z",
	populatedAt: "2026-08-14T00:00:00.000Z",
	entitySchemaSlug: EntitySchemaSlug.make("book"),
	providerId: SandboxProviderId.make("provider-1"),
};

const makeLayer = (input: {
	readonly requests: RequestFillInput[];
	readonly redis: RedisService["Service"];
	readonly store: Layer.Layer<EntityInterestStore>;
}) =>
	EntityInterestProgression.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				input.store,
				Layer.succeed(RedisService, input.redis),
				Layer.mock(EntitiesService)({ getByIdAnyScope: () => Effect.succeed(entity) }),
				Layer.mock(TranslationsService)({
					requestFill: (request) =>
						Effect.sync(() => {
							input.requests.push(request);
						}),
				}),
				Layer.mock(PluginRuntimeResolver)({
					findActiveProviderById: () =>
						Effect.succeed({
							slug: "provider",
							name: "Provider",
							pluginSlug: "plugin",
							rootEntitySchemaSlug: "entity",
							id: SandboxProviderId.make("provider-1"),
							createdAt: new Date("2026-08-14T00:00:00.000Z"),
							updatedAt: new Date("2026-08-14T00:00:00.000Z"),
							information: { source: "fixture", canonicalLanguage: "en" },
						}),
				}),
			),
		),
	);

it.effect("uses one entity lease and requests each distinct noncanonical language", () => {
	const requests: RequestFillInput[] = [];
	const acquired: Array<readonly [string, number]> = [];
	const events: string[] = [];
	const released: string[] = [];
	const store = Layer.mock(EntityInterestStore)({
		listInterestedSessions: () =>
			Effect.sync(() => {
				events.push("list");
				return ["session-1", "session-2", "session-3", "session-4", "session-5"];
			}),
		getSessionMetadata: (sessionIds) =>
			Effect.sync(() => {
				events.push(`metadata:${sessionIds.join(",")}`);
				return [
					{
						revision: 1,
						preferredLanguage: "es",
						sessionId: sessionIds[0] ?? "",
						userId: UserId.make("user-1"),
					},
					{
						revision: 1,
						preferredLanguage: "es",
						sessionId: sessionIds[1] ?? "",
						userId: UserId.make("user-2"),
					},
					{
						revision: 1,
						preferredLanguage: "fr",
						sessionId: sessionIds[2] ?? "",
						userId: UserId.make("user-3"),
					},
					{
						revision: 1,
						preferredLanguage: "en",
						sessionId: sessionIds[3] ?? "",
						userId: UserId.make("user-4"),
					},
					{
						revision: 1,
						preferredLanguage: null,
						sessionId: sessionIds[4] ?? "",
						userId: UserId.make("user-5"),
					},
				];
			}),
	});
	const redis = makeRedisService({
		acquireLease: (key, ttl) =>
			Effect.sync(() => {
				events.push("acquire");
				acquired.push([key, ttl]);
				return crypto.randomUUID();
			}),
		releaseLease: (key) =>
			Effect.sync(() => {
				events.push("release");
				released.push(key);
			}),
	});

	return Effect.gen(function* () {
		const progression = yield* EntityInterestProgression;
		yield* progression.populated(entityId);

		expect(acquired).toEqual([["ryot:entity-interest:progress:entity-1", 30]]);
		expect(events).toEqual([
			"acquire",
			"list",
			"metadata:session-1,session-2,session-3,session-4,session-5",
			"release",
		]);
		expect(requests.map(({ language }) => language)).toEqual(["es", "fr"]);
		expect(released).toEqual(["ryot:entity-interest:progress:entity-1"]);
	}).pipe(Effect.provide(makeLayer({ redis, requests, store })));
});

it.effect("retries a contended lease once near expiry", () => {
	let attempts = 0;
	const sleeps: number[] = [];
	const acquired: string[] = [];
	const released: string[] = [];
	const requests: RequestFillInput[] = [];
	const store = Layer.mock(EntityInterestStore)({
		listInterestedSessions: () => Effect.succeed(["session-1"]),
		getSessionMetadata: () => Effect.succeed([]),
	});
	const redis = makeRedisService({
		acquireLease: (key) =>
			Effect.sync(() => {
				acquired.push(key);
				attempts += 1;
				return attempts === 1 ? null : crypto.randomUUID();
			}),
		releaseLease: (key) =>
			Effect.sync(() => {
				released.push(key);
			}),
	});
	const clock: Clock.Clock = {
		currentTimeMillisUnsafe: () => 0,
		currentTimeMillis: Effect.succeed(0),
		currentTimeNanosUnsafe: () => 0n,
		currentTimeNanos: Effect.succeed(0n),
		monotonicTimeNanosUnsafe: () => 0n,
		monotonicTimeNanos: Effect.succeed(0n),
		sleep: (duration) =>
			Effect.sync(() => {
				sleeps.push(Duration.toMillis(duration));
			}),
	};

	return Effect.gen(function* () {
		const progression = yield* EntityInterestProgression;
		yield* progression.populated(entityId);

		expect(attempts).toBe(2);
		expect(acquired).toEqual([
			"ryot:entity-interest:progress:entity-1",
			"ryot:entity-interest:progress:entity-1",
		]);
		expect(sleeps).toEqual([29_000]);
		expect(released).toEqual(["ryot:entity-interest:progress:entity-1"]);
	}).pipe(
		Effect.provide(makeLayer({ redis, requests, store })),
		Effect.provideService(Clock.Clock, clock),
	);
});
