import { Effect, Schema } from "effect";

import { RedisService, redisKeys } from "#lib/redis";

const IMPORT_SOURCE_PAYLOAD_TTL_SECONDS = 24 * 60 * 60;

const SourcePayloadFromJson = Schema.parseJson(
	Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);

export const storeImportSourcePayload = (input: {
	runId: string;
	sourcePayload: Record<string, unknown>;
}) =>
	Effect.gen(function* () {
		const redis = yield* RedisService;
		const serialized = yield* Schema.encode(SourcePayloadFromJson)(input.sourcePayload).pipe(
			Effect.orDie,
		);
		yield* redis.set(
			redisKeys.importSourcePayload(input.runId),
			serialized,
			IMPORT_SOURCE_PAYLOAD_TTL_SECONDS,
		);
	});

export const loadImportSourcePayload = (runId: string) =>
	Effect.gen(function* () {
		const redis = yield* RedisService;
		const raw = yield* redis.get(redisKeys.importSourcePayload(runId));
		if (raw === null) {
			return null;
		}
		return yield* Schema.decode(SourcePayloadFromJson)(raw).pipe(Effect.orElseSucceed(() => null));
	});

export const deleteImportSourcePayload = (runId: string) =>
	Effect.gen(function* () {
		const redis = yield* RedisService;
		yield* redis.del(redisKeys.importSourcePayload(runId));
	});
