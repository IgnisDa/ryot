import { z } from "zod";
import { apiFunctionDescriptorSchema } from "~/lib/sandbox/types";
import {
	nonEmptyStringSchema,
	nullableStringSchema,
	positiveIntSchema,
	stringUnknownRecordSchema,
} from "~/lib/zod/base";

export const sandboxRunJobName = "sandbox-run";

export const sandboxRunJobData = z.object({
	code: nonEmptyStringSchema,
	userId: nonEmptyStringSchema,
	timeoutMs: positiveIntSchema.optional(),
	maxHeapMB: positiveIntSchema.optional(),
	scriptId: nonEmptyStringSchema.optional(),
	context: stringUnknownRecordSchema.optional(),
	apiFunctionDescriptors: z.array(apiFunctionDescriptorSchema).optional(),
});

export const sandboxRunJobResult = z.object({
	success: z.boolean(),
	logs: nullableStringSchema,
	error: nullableStringSchema,
	value: z.unknown().optional(),
});

export type SandboxRunJobData = z.infer<typeof sandboxRunJobData>;
