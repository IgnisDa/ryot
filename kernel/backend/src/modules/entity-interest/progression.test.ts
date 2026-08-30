import { expect, layer } from "@effect/vitest";
import {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Clock, Context, Duration, Effect, Layer, Ref } from "effect";

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
	name: "Record",
	externalId: "record-1",
	properties: { title: "Record" },
	createdAt: "2026-08-14T00:00:00.000Z",
	updatedAt: "2026-08-14T00:00:00.000Z",
	populatedAt: "2026-08-14T00:00:00.000Z",
	providerId: SandboxProviderId.make("provider-1"),
	entitySchemaSlug: EntitySchemaSlug.make("record"),
};

type SessionMetadata = Effect.Success<
	ReturnType<EntityInterestStore["Service"]["getSessionMetadata"]>
>;

class FakeProgressionEffects extends Context.Service<
	FakeProgressionEffects,
	{
		readonly events: Effect.Effect<ReadonlyArray<string>>;
		readonly acquired: Effect.Effect<ReadonlyArray<readonly [string, number]>>;
		readonly released: Effect.Effect<ReadonlyArray<string>>;
		readonly requests: Effect.Effect<ReadonlyArray<RequestFillInput>>;
	}
>()("test/FakeProgressionEffects") {}

const makeLayer = (input: {
	readonly sessions: ReadonlyArray<string>;
	readonly metadata: (sessionIds: ReadonlyArray<string>) => SessionMetadata;
	readonly grantLease?: (attempt: number) => boolean;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const events = yield* Ref.make<ReadonlyArray<string>>([]);
			const acquired = yield* Ref.make<ReadonlyArray<readonly [string, number]>>([]);
			const released = yield* Ref.make<ReadonlyArray<string>>([]);
			const requests = yield* Ref.make<ReadonlyArray<RequestFillInput>>([]);
			const event = (name: string) => Ref.update(events, (all) => [...all, name]);
			const store = Layer.mock(EntityInterestStore)({
				listInterestedSessions: () => event("list").pipe(Effect.as([...input.sessions])),
				getSessionMetadata: (sessionIds) =>
					event(`metadata:${sessionIds.join(",")}`).pipe(Effect.as(input.metadata(sessionIds))),
			});
			const redis = makeRedisService({
				releaseLease: (key) =>
					event("release").pipe(Effect.andThen(Ref.update(released, (all) => [...all, key]))),
				acquireLease: (key, ttl) =>
					event("acquire").pipe(
						Effect.andThen(Ref.updateAndGet(acquired, (all) => [...all, [key, ttl] as const])),
						Effect.map((all) =>
							(input.grantLease?.(all.length) ?? true) ? crypto.randomUUID() : null,
						),
					),
			});
			return EntityInterestProgression.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						databaseLayer,
						store,
						Layer.succeed(RedisService, redis),
						Layer.mock(EntitiesService)({ getByIdAnyScope: () => Effect.succeed(entity) }),
						Layer.mock(TranslationsService)({
							requestFill: (request) => Ref.update(requests, (all) => [...all, request]),
						}),
						Layer.mock(PluginRuntimeResolver)({
							findProviderAvailableToUser: () =>
								Effect.succeed({
									slug: "provider",
									name: "Provider",
									pluginId: "plugin",
									pluginScope: "user",
									rootEntitySchemaSlug: "entity",
									id: SandboxProviderId.make("provider-1"),
									createdAt: new Date("2026-08-14T00:00:00.000Z"),
									updatedAt: new Date("2026-08-14T00:00:00.000Z"),
									information: { source: "fixture", canonicalLanguage: "en" },
								}),
						}),
						Layer.succeed(FakeProgressionEffects, {
							events: Ref.get(events),
							acquired: Ref.get(acquired),
							released: Ref.get(released),
							requests: Ref.get(requests),
						}),
					),
				),
			);
		}),
	);

layer(
	makeLayer({
		sessions: ["session-1", "session-2", "session-3", "session-4", "session-5"],
		metadata: (sessionIds) => [
			{
				revision: 1,
				preferredLanguage: "es",
				userId: UserId.make("user-1"),
				sessionId: sessionIds[0] ?? "",
			},
			{
				revision: 1,
				preferredLanguage: "es",
				userId: UserId.make("user-2"),
				sessionId: sessionIds[1] ?? "",
			},
			{
				revision: 1,
				preferredLanguage: "fr",
				userId: UserId.make("user-3"),
				sessionId: sessionIds[2] ?? "",
			},
			{
				revision: 1,
				preferredLanguage: "en",
				userId: UserId.make("user-4"),
				sessionId: sessionIds[3] ?? "",
			},
			{
				revision: 1,
				preferredLanguage: null,
				userId: UserId.make("user-5"),
				sessionId: sessionIds[4] ?? "",
			},
		],
	}),
)((test) => {
	test.effect("uses one entity lease and requests each distinct noncanonical language", () =>
		Effect.gen(function* () {
			const progression = yield* EntityInterestProgression;
			yield* progression.populated(entityId);

			const effects = yield* FakeProgressionEffects;
			expect(yield* effects.acquired).toEqual([["ryot:entity-interest:progress:entity-1", 30]]);
			expect(yield* effects.events).toEqual([
				"acquire",
				"list",
				"metadata:session-1,session-2,session-3,session-4,session-5",
				"release",
			]);
			expect((yield* effects.requests).map(({ language }) => language)).toEqual(["es", "fr"]);
			expect(yield* effects.released).toEqual(["ryot:entity-interest:progress:entity-1"]);
		}),
	);
});

layer(
	makeLayer({ metadata: () => [], sessions: ["session-1"], grantLease: (attempt) => attempt > 1 }),
)((test) => {
	test.effect("retries a contended lease once near expiry", () => {
		const sleeps: number[] = [];
		const clock: Clock.Clock = {
			currentTimeMillisUnsafe: () => 0,
			currentTimeNanosUnsafe: () => 0n,
			monotonicTimeNanosUnsafe: () => 0n,
			currentTimeMillis: Effect.succeed(0),
			currentTimeNanos: Effect.succeed(0n),
			monotonicTimeNanos: Effect.succeed(0n),
			sleep: (duration) =>
				Effect.sync(() => {
					sleeps.push(Duration.toMillis(duration));
				}),
		};

		return Effect.gen(function* () {
			const progression = yield* EntityInterestProgression;
			yield* progression.populated(entityId);

			const effects = yield* FakeProgressionEffects;
			const acquired = yield* effects.acquired;
			expect(acquired).toHaveLength(2);
			expect(acquired.map(([key]) => key)).toEqual([
				"ryot:entity-interest:progress:entity-1",
				"ryot:entity-interest:progress:entity-1",
			]);
			expect(sleeps).toEqual([29_000]);
			expect(yield* effects.released).toEqual(["ryot:entity-interest:progress:entity-1"]);
		}).pipe(Effect.provideService(Clock.Clock, clock));
	});
});
