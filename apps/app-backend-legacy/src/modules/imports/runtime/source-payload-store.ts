import { redis } from "~/lib/redis";
import { redisKeys, redisValues, type ImportSourcePayloadRedisValue } from "~/lib/redis-keys";

const IMPORT_SOURCE_PAYLOAD_TTL_SECONDS = 24 * 60 * 60;

export const storeImportSourcePayload = async (input: {
	runId: string;
	sourcePayload: ImportSourcePayloadRedisValue;
}): Promise<void> => {
	await redis.set(
		redisKeys.imports.sourcePayload(input.runId),
		redisValues.imports.sourcePayload.stringify(input.sourcePayload),
		"EX",
		IMPORT_SOURCE_PAYLOAD_TTL_SECONDS,
	);
};

export const getImportSourcePayload = async (
	runId: string,
): Promise<ImportSourcePayloadRedisValue | null> => {
	const raw = await redis.get(redisKeys.imports.sourcePayload(runId));
	if (raw === null) {
		return null;
	}
	const parsed = redisValues.imports.sourcePayload.safeParse(raw);
	return parsed.success ? parsed.data : null;
};

export const deleteImportSourcePayload = async (runId: string): Promise<void> => {
	await redis.del(redisKeys.imports.sourcePayload(runId));
};
