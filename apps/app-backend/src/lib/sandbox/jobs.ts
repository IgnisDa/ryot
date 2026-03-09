import { z } from "zod";
import {
	nonEmptyStringSchema,
	nullableStringSchema,
	positiveIntSchema,
	stringUnknownRecordSchema,
} from "~/lib/zod/base";

export const sandboxRunJobName = "sandbox-run";
export const sandboxRunJobWaitTimeoutMs = 30_000;

export const sandboxRunJobData = z.object({
	code: nonEmptyStringSchema,
	userId: nonEmptyStringSchema,
	timeoutMs: positiveIntSchema.optional(),
	maxHeapMB: positiveIntSchema.optional(),
	context: stringUnknownRecordSchema.optional(),
	apiFunctionsId: nonEmptyStringSchema.optional(),
});

export const sandboxRunJobResult = z.object({
	success: z.boolean(),
	logs: nullableStringSchema,
	error: nullableStringSchema,
	value: z.unknown().optional(),
});

export type SandboxRunJobData = z.infer<typeof sandboxRunJobData>;
