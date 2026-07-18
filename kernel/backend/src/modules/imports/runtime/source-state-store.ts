import { Effect, Schema } from "effect";

import {
	IMPORT_SOURCE_STATE_CLAIMED_TTL_SECONDS,
	IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
	ImportSourceStateFromJson,
	RedisService,
	redisKeys,
	type ImportSourceState,
} from "#lib/infrastructure/redis";

export const storeImportSourceState = Effect.fn("imports.storeImportSourceState")(
	function* (input: { stateId: string; state: ImportSourceState }) {
		const redis = yield* RedisService;
		const serialized = yield* Schema.encodeUnknownEffect(ImportSourceStateFromJson)(
			input.state,
		).pipe(Effect.orDie);
		yield* redis.set(
			redisKeys.importSourceState(input.stateId),
			serialized,
			IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
		);
	},
);

export const claimImportSourceState = Effect.fn("imports.claimImportSourceState")(function* (
	stateId: string,
	claimId: string,
) {
	const redis = yield* RedisService;
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

export const deleteImportSourceState = Effect.fn("imports.deleteImportSourceState")(function* (
	stateId: string,
	claimId?: string,
) {
	const redis = yield* RedisService;
	yield* redis.del(
		redisKeys.importSourceState(stateId),
		...(claimId ? [redisKeys.importSourceStateClaim(stateId, claimId)] : []),
	);
});
