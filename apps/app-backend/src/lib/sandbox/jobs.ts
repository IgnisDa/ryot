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

export const executionTimingsSchema = z.object({
	totalMs: z.number(),
	processMs: z.number(),
	hostSetupMs: z.number(),
	poolHit: z.boolean().optional(),
	cpuUserMs: z.number().optional(),
	cpuSystemMs: z.number().optional(),
});

export const denoMetricsSchema = z.object({
	startupMs: z.number(),
	scriptExecMs: z.number(),
	memoryRssBytes: z.number(),
	memoryHeapUsedBytes: z.number(),
});

export const sandboxRunJobResult = z.object({
	success: z.boolean(),
	logs: nullableStringSchema,
	error: nullableStringSchema,
	value: z.unknown().optional(),
	denoMetrics: denoMetricsSchema.optional(),
	timings: executionTimingsSchema.optional(),
});

export type SandboxRunJobData = z.infer<typeof sandboxRunJobData>;
export type ExecutionTimings = z.infer<typeof executionTimingsSchema>;
export type DenoMetrics = z.infer<typeof denoMetricsSchema>;
export type QueuedRunResult = z.infer<typeof sandboxRunJobResult>;
