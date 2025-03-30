import { z } from "@hono/zod-openapi";
import { dataSchema } from "~/lib/openapi";
import {
	createIdParamsSchema,
	nonEmptyStringSchema,
	stringUnknownRecordSchema,
} from "~/lib/zod/base";

export const enqueueSandboxBody = z.object({
	context: stringUnknownRecordSchema.optional(),
	code: nonEmptyStringSchema.max(20_000),
});

export const sandboxJobParams = createIdParamsSchema("jobId");

export const enqueueSandboxResponseSchema = dataSchema(
	z.object({ jobId: nonEmptyStringSchema }),
);

export const sandboxPendingResultSchema = z.object({
	status: z.literal("pending"),
});

export const sandboxFailedResultSchema = z.object({
	error: nonEmptyStringSchema,
	status: z.literal("failed"),
});

const sandboxResultValueSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
	z.array(z.unknown()),
	z.record(z.string(), z.unknown()),
]);

export const sandboxCompletedResultSchema = z.object({
	logs: z.string().nullable(),
	error: z.string().nullable(),
	value: sandboxResultValueSchema,
	status: z.literal("completed"),
});

export const pollSandboxResultResponseSchema = dataSchema(
	z.discriminatedUnion("status", [
		sandboxPendingResultSchema,
		sandboxFailedResultSchema,
		sandboxCompletedResultSchema,
	]),
);

export type EnqueueSandboxBody = z.infer<typeof enqueueSandboxBody>;
