import { z } from "@hono/zod-openapi";
import { apiFunctionDescriptorSchema } from "~/lib/sandbox/types";
import {
	nonEmptyStringSchema,
	nullableStringSchema,
	positiveIntSchema,
	stringUnknownRecordSchema,
} from "~/lib/zod";

export const sandboxRunJobName = "execute";

export const sandboxRunJobData = z.object({
	code: nonEmptyStringSchema,
	userId: nonEmptyStringSchema,
	scriptId: nonEmptyStringSchema,
	driverName: nonEmptyStringSchema,
	timeoutMs: positiveIntSchema.optional(),
	maxHeapMB: positiveIntSchema.optional(),
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
