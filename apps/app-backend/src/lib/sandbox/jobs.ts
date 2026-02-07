import { z } from "@hono/zod-openapi";
import {
	nonEmptyStringSchema,
	nullableStringSchema,
	positiveIntSchema,
	stringUnknownRecordSchema,
} from "~/lib/zod";

export const sandboxRunJobName = "execute";

export const sandboxRunJobData = z.object({
	userId: nonEmptyStringSchema,
	scriptId: nonEmptyStringSchema,
	driverName: nonEmptyStringSchema,
	timeoutMs: positiveIntSchema.optional(),
	maxHeapMB: positiveIntSchema.optional(),
	context: stringUnknownRecordSchema.optional(),
});

export const sandboxTimingSchema = z.object({
	totalMs: z.number(),
	executionMs: z.number(),
});

export const sandboxRunJobResult = z.object({
	success: z.boolean(),
	logs: nullableStringSchema,
	error: nullableStringSchema,
	value: z.unknown().optional(),
	timing: sandboxTimingSchema.optional(),
});

export type SandboxRunJobData = z.infer<typeof sandboxRunJobData>;
export type QueuedRunResult = z.infer<typeof sandboxRunJobResult>;
