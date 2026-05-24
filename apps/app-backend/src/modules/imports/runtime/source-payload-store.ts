import { redis } from "~/lib/redis";
import { redisKeys, redisValues, type ImportSourcePayloadRedisValue } from "~/lib/redis-keys";

export const IMPORT_SOURCE_PAYLOAD_TTL_SECONDS = 24 * 60 * 60;

type SourcePayloadStoreRedis = {
	del(key: string): Promise<number>;
	get(key: string): Promise<string | null>;
	set(key: string, value: string, exMode: "EX", ttlSeconds: number): Promise<"OK">;
};

type SourcePayloadStoreDeps = {
	redis?: SourcePayloadStoreRedis;
};

const defaultDeps: Required<SourcePayloadStoreDeps> = { redis };

export const storeImportSourcePayload = async (
	input: { runId: string; sourcePayload: ImportSourcePayloadRedisValue },
	deps: SourcePayloadStoreDeps = {},
): Promise<void> => {
	const r = deps.redis ?? defaultDeps.redis;
	await r.set(
		redisKeys.imports.sourcePayload(input.runId),
		redisValues.imports.sourcePayload.stringify(input.sourcePayload),
		"EX",
		IMPORT_SOURCE_PAYLOAD_TTL_SECONDS,
	);
};

export const getImportSourcePayload = async (
	runId: string,
	deps: SourcePayloadStoreDeps = {},
): Promise<ImportSourcePayloadRedisValue | null> => {
	const r = deps.redis ?? defaultDeps.redis;
	const raw = await r.get(redisKeys.imports.sourcePayload(runId));
	if (raw === null) {
		return null;
	}
	const parsed = redisValues.imports.sourcePayload.safeParse(raw);
	return parsed.success ? parsed.data : null;
};

export const deleteImportSourcePayload = async (
	runId: string,
	deps: SourcePayloadStoreDeps = {},
): Promise<void> => {
	const r = deps.redis ?? defaultDeps.redis;
	await r.del(redisKeys.imports.sourcePayload(runId));
};
