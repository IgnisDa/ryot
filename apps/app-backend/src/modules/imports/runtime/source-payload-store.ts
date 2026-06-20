import { Effect, Schema } from "effect";

import { RedisService, redisKeys } from "#lib/infrastructure/redis";

import {
	MediaImportAdapterFailureSchema,
	MediaImportAdapterResultSchema,
	type MediaImportAdapterResult,
} from "../media/adapter-result";
import { ImportMediaEntityGroupSchema } from "../media/types";

const IMPORT_SOURCE_PAYLOAD_TTL_SECONDS = 24 * 60 * 60;

const SourcePayloadFromJson = Schema.parseJson(
	Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);

const adapterChunkSize = 100;
const AdapterChunkFromJson = Schema.parseJson(Schema.Array(ImportMediaEntityGroupSchema));
export const AdapterManifest = Schema.Struct({
	groups: Schema.Number,
	chunkCount: Schema.Number,
	failures: Schema.Array(MediaImportAdapterFailureSchema),
});
const AdapterManifestFromJson = Schema.parseJson(AdapterManifest);

export const storeImportSourcePayload = Effect.fn("imports.storeImportSourcePayload")(
	function* (input: { runId: string; sourcePayload: Record<string, unknown> }) {
		const redis = yield* RedisService;
		const serialized = yield* Schema.encode(SourcePayloadFromJson)(input.sourcePayload).pipe(
			Effect.orDie,
		);
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
	return yield* Schema.decode(SourcePayloadFromJson)(raw).pipe(Effect.orElseSucceed(() => null));
});

export const deleteImportSourcePayload = Effect.fn("imports.deleteImportSourcePayload")(function* (
	runId: string,
) {
	const redis = yield* RedisService;
	yield* redis.del(redisKeys.importSourcePayload(runId));
});

export const storeImportAdapterResult = Effect.fn("imports.storeImportAdapterResult")(
	function* (input: { runId: string; adapterResult: MediaImportAdapterResult }) {
		const redis = yield* RedisService;
		const chunks = Array.from(
			{ length: Math.ceil(input.adapterResult.entityGroups.length / adapterChunkSize) },
			(_, index) =>
				input.adapterResult.entityGroups.slice(
					index * adapterChunkSize,
					(index + 1) * adapterChunkSize,
				),
		);
		const serialized = yield* Schema.encode(AdapterManifestFromJson)({
			chunkCount: chunks.length,
			failures: input.adapterResult.failures,
			groups: input.adapterResult.entityGroups.length,
		}).pipe(Effect.orDie);
		yield* redis.set(
			redisKeys.importAdapterResult(input.runId),
			serialized,
			IMPORT_SOURCE_PAYLOAD_TTL_SECONDS,
		);
		yield* Effect.forEach(
			chunks,
			(chunk, index) =>
				Schema.encode(AdapterChunkFromJson)(chunk).pipe(
					Effect.orDie,
					Effect.flatMap((encoded) =>
						redis.set(
							redisKeys.importAdapterChunk(input.runId, index),
							encoded,
							IMPORT_SOURCE_PAYLOAD_TTL_SECONDS,
						),
					),
				),
			{ concurrency: 4, discard: true },
		);
	},
);

export const loadImportAdapterManifest = Effect.fn("imports.loadImportAdapterManifest")(function* (
	runId: string,
) {
	const redis = yield* RedisService;
	const raw = yield* redis.get(redisKeys.importAdapterResult(runId));
	if (raw === null) {
		return null;
	}
	return yield* Schema.decode(AdapterManifestFromJson)(raw).pipe(Effect.orElseSucceed(() => null));
});

export const loadImportAdapterChunk = Effect.fn("imports.loadImportAdapterChunk")(function* (
	runId: string,
	index: number,
) {
	const redis = yield* RedisService;
	const raw = yield* redis.get(redisKeys.importAdapterChunk(runId, index));
	if (raw === null) {
		return null;
	}
	return yield* Schema.decode(AdapterChunkFromJson)(raw).pipe(Effect.orElseSucceed(() => null));
});

export const loadImportAdapterResult = Effect.fn("imports.loadImportAdapterResult")(function* (
	runId: string,
) {
	const manifest = yield* loadImportAdapterManifest(runId);
	if (manifest === null) {
		return null;
	}
	const chunks = yield* Effect.forEach(
		Array.from({ length: manifest.chunkCount }, (_, index) => index),
		(index) => loadImportAdapterChunk(runId, index),
	);
	if (chunks.some((chunk) => chunk === null)) {
		return null;
	}
	return yield* Schema.decodeUnknown(MediaImportAdapterResultSchema)({
		failures: manifest.failures,
		entityGroups: chunks.flatMap((chunk) => chunk ?? []),
	}).pipe(Effect.orElseSucceed(() => null));
});

export const deleteImportAdapterResult = Effect.fn("imports.deleteImportAdapterResult")(function* (
	runId: string,
) {
	const redis = yield* RedisService;
	const manifest = yield* loadImportAdapterManifest(runId);
	yield* redis.del(
		redisKeys.importAdapterResult(runId),
		...Array.from({ length: manifest?.chunkCount ?? 0 }, (_, index) =>
			redisKeys.importAdapterChunk(runId, index),
		),
	);
});
