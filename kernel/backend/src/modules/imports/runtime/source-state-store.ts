import { Context, Effect, Layer, Schema } from "effect";

import {
	IMPORT_SOURCE_STATE_CLAIMED_TTL_SECONDS,
	IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
	ImportSourceStateFromJson,
	RedisService,
	redisKeys,
	type ImportSourceState,
} from "#lib/infrastructure/redis";

export class ImportSourceStateStore extends Context.Service<ImportSourceStateStore>()(
	"ImportSourceStateStore",
	{
		make: Effect.gen(function* () {
			const redis = yield* RedisService;

			const store = Effect.fn("ImportSourceStateStore.store")(function* (input: {
				stateId: string;
				state: ImportSourceState;
			}) {
				const serialized = yield* Schema.encodeUnknownEffect(ImportSourceStateFromJson)(
					input.state,
				).pipe(Effect.orDie);
				yield* redis.set(
					redisKeys.importSourceState(input.stateId),
					serialized,
					IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
				);
			});

			const claim = Effect.fn("ImportSourceStateStore.claim")(function* (
				stateId: string,
				claimId: string,
			) {
				const raw = yield* redis.claim(
					redisKeys.importSourceState(stateId),
					redisKeys.importSourceStateClaim(stateId, claimId),
					IMPORT_SOURCE_STATE_CLAIMED_TTL_SECONDS,
				);
				if (raw === null) {
					return null;
				}
				return yield* Schema.decodeEffect(ImportSourceStateFromJson)(raw).pipe(
					Effect.orElseSucceed(() => null),
				);
			});

			const remove = Effect.fn("ImportSourceStateStore.remove")(function* (
				stateId: string,
				claimId?: string,
			) {
				yield* redis.del(
					redisKeys.importSourceState(stateId),
					...(claimId ? [redisKeys.importSourceStateClaim(stateId, claimId)] : []),
				);
			});

			return { store, claim, remove };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
