import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { Effect, Schema } from "effect";

import { RedisService, redisKeys } from "#lib/infrastructure/redis";

const IMPORT_SOURCE_PAYLOAD_TTL_SECONDS = 24 * 60 * 60;

const SourcePayloadFromJson = Schema.fromJsonString(Schema.Record(Schema.String, jsonValueSchema));

export const storeImportSourcePayload = Effect.fn("imports.storeImportSourcePayload")(
	function* (input: { runId: string; sourcePayload: Record<string, JsonValue> }) {
		const redis = yield* RedisService;
		const serialized = yield* Schema.encodeUnknownEffect(SourcePayloadFromJson)(
			input.sourcePayload,
		).pipe(Effect.orDie);
		yield* redis.set(
			redisKeys.importSourcePayload(input.runId),
			serialized,
			IMPORT_SOURCE_PAYLOAD_TTL_SECONDS,
		);
	},
);

export const loadImportSourcePayload = Effect.fn("imports.loadImportSourcePayload")(function* (
	runId: string,
) {
	const redis = yield* RedisService;
	const raw = yield* redis.get(redisKeys.importSourcePayload(runId));
	if (raw === null) {
		return null;
	}
	return yield* Schema.decodeUnknownEffect(SourcePayloadFromJson)(raw).pipe(
		Effect.orElseSucceed(() => null),
	);
});

export const deleteImportSourcePayload = Effect.fn("imports.deleteImportSourcePayload")(function* (
	runId: string,
) {
	const redis = yield* RedisService;
	yield* redis.del(redisKeys.importSourcePayload(runId));
});
