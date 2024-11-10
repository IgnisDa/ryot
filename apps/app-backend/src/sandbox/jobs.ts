import { z } from "zod";

export const sandboxRunJobName = "sandbox-run";
export const sandboxRunJobWaitTimeoutMs = 30_000;

export const sandboxRunJobData = z.object({
	code: z.string().min(1),
	timeoutMs: z.number().int().positive().optional(),
	maxHeapMB: z.number().int().positive().optional(),
	apiFunctionsId: z.string().min(1).optional(),
	context: z.record(z.string(), z.unknown()).optional(),
});

export const sandboxRunJobResult = z.object({
	success: z.boolean(),
	logs: z.string().optional(),
	error: z.string().optional(),
	value: z.unknown().optional(),
});

export type SandboxRunJobData = z.infer<typeof sandboxRunJobData>;
