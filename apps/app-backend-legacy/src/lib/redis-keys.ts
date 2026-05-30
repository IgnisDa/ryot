import { z } from "@hono/zod-openapi";

import { type JsonValue, jsonValueSchema } from "~/lib/json-value";
import { nonEmptyStringSchema, positiveIntSchema } from "~/lib/zod";

type RedisDecodeResult<T> = { data: T; success: true } | { success: false };

type RedisValueCodec<TStored, TInput = TStored> = {
	parse: (raw: string) => TStored;
	stringify: (value: TInput) => string;
	parseNullable: (raw: string | null) => TStored | null;
	safeParse: (raw: string) => RedisDecodeResult<TStored>;
};

const sandboxCacheKeyPrefix = "sandbox:cache:";
const sandboxSessionKeyPrefix = "sandbox:session:";
const godModeResetChannelPrefix = "god-mode:reset:";
const godModePendingResetKeyPrefix = "god-mode:pending:";
const importUploadTokenKeyPrefix = "import:upload:token:";
const importSourcePayloadKeyPrefix = "import:source-payload:";
const integrationCacheKeyPrefix = "integration:cache:";

const safeDecode = <T>(decode: () => T): RedisDecodeResult<T> => {
	try {
		return { data: decode(), success: true };
	} catch {
		return { success: false };
	}
};

const createStringCodec = <TStored extends string>(
	schema: z.ZodType<TStored>,
): RedisValueCodec<TStored> => ({
	parse: (raw) => schema.parse(raw),
	stringify: (value) => schema.parse(value),
	parseNullable: (raw) => (raw === null ? null : schema.parse(raw)),
	safeParse: (raw) => {
		const result = schema.safeParse(raw);
		return result.success ? { data: result.data, success: true } : { success: false };
	},
});

const createJsonCodec = <TStored>(schema: z.ZodType<TStored>): RedisValueCodec<TStored> => ({
	parse: (raw) => schema.parse(JSON.parse(raw)),
	stringify: (value) => JSON.stringify(schema.parse(value)),
	parseNullable: (raw) => (raw === null ? null : schema.parse(JSON.parse(raw))),
	safeParse: (raw) =>
		safeDecode(() => {
			return schema.parse(JSON.parse(raw));
		}),
});

const createRoundTripJsonCodec = <TStored>(
	schema: z.ZodType<TStored>,
): RedisValueCodec<TStored, unknown> => ({
	parse: (raw) => schema.parse(JSON.parse(raw)),
	parseNullable: (raw) => (raw === null ? null : schema.parse(JSON.parse(raw))),
	safeParse: (raw) =>
		safeDecode(() => {
			return schema.parse(JSON.parse(raw));
		}),
	stringify: (value) => {
		const serialized = JSON.stringify(value);
		schema.parse(JSON.parse(serialized));
		return serialized;
	},
});

const godModeResetChannelValueSchema = z
	.object({ email: nonEmptyStringSchema, resetUrl: nonEmptyStringSchema })
	.strict();

const sandboxSessionRedisValueSchema = z
	.object({ token: nonEmptyStringSchema, expiresAt: positiveIntSchema })
	.strict();

const importUploadTokenRedisValueSchema = z
	.object({ userId: nonEmptyStringSchema, resolvedPath: nonEmptyStringSchema })
	.strict();

const importSourcePayloadRedisValueSchema = z.record(z.string(), z.unknown());

export type SandboxCacheRedisValue = JsonValue;
export type GodModeResetChannelValue = z.infer<typeof godModeResetChannelValueSchema>;
export type SandboxSessionRedisValue = z.infer<typeof sandboxSessionRedisValueSchema>;
export type ImportUploadTokenRedisValue = z.infer<typeof importUploadTokenRedisValueSchema>;
export type ImportSourcePayloadRedisValue = z.infer<typeof importSourcePayloadRedisValueSchema>;

export const redisKeys = {
	imports: {
		uploadToken: (token: string) => `${importUploadTokenKeyPrefix}${token}`,
		sourcePayload: (runId: string) => `${importSourcePayloadKeyPrefix}${runId}`,
	},
	godMode: {
		pendingReset: (email: string) => `${godModePendingResetKeyPrefix}${email}`,
		resetChannel: (correlationId: string) => `${godModeResetChannelPrefix}${correlationId}`,
	},
	integrations: {
		cache: (integrationId: string, key: string) =>
			`${integrationCacheKeyPrefix}${integrationId}:${key}`,
	},
	sandbox: {
		sessionPattern: () => `${sandboxSessionKeyPrefix}*`,
		session: (executionId: string) => `${sandboxSessionKeyPrefix}${executionId}`,
		cache: (scriptId: string, key: string) => `${sandboxCacheKeyPrefix}${scriptId}:${key}`,
	},
} as const;

export const redisValues = {
	sandbox: {
		cache: createRoundTripJsonCodec(jsonValueSchema),
		session: createJsonCodec(sandboxSessionRedisValueSchema),
	},
	godMode: {
		pendingReset: createStringCodec(nonEmptyStringSchema),
		resetChannel: createJsonCodec(godModeResetChannelValueSchema),
	},
	imports: {
		uploadToken: createJsonCodec(importUploadTokenRedisValueSchema),
		sourcePayload: createJsonCodec(importSourcePayloadRedisValueSchema),
	},
} as const;
