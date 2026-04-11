import { z } from "@hono/zod-openapi";
import { dataSchema } from "~/lib/openapi";
import {
	createIdParamsSchema,
	nonEmptyStringSchema,
	stringUnknownRecordSchema,
} from "~/lib/zod/base";

const enqueueSandboxCodeBody = z.object({
	driverName: nonEmptyStringSchema,
	kind: z.literal("code").optional(),
	context: stringUnknownRecordSchema.optional(),
	code: nonEmptyStringSchema.max(20_000),
});

const enqueueSandboxScriptBody = z.object({
	scriptId: nonEmptyStringSchema,
	kind: z.literal("script"),
	driverName: nonEmptyStringSchema,
	context: stringUnknownRecordSchema.optional(),
});

export const enqueueSandboxBody = z.union([
	enqueueSandboxCodeBody,
	enqueueSandboxScriptBody,
]);

export const sandboxJobParams = createIdParamsSchema("jobId");

export const enqueueSandboxResponseSchema = dataSchema(
	z.object({ jobId: nonEmptyStringSchema }),
);

export type SandboxEnqueueResult = z.infer<
	typeof enqueueSandboxResponseSchema.shape.data
>;

export const sandboxPendingResultSchema = z.object({
	status: z.literal("pending"),
});

export const sandboxFailedResultSchema = z.object({
	error: nonEmptyStringSchema,
	status: z.literal("failed"),
});

const sandboxResultValueSchema = z.union([
	z.null(),
	z.string(),
	z.number(),
	z.boolean(),
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
		sandboxFailedResultSchema,
		sandboxPendingResultSchema,
		sandboxCompletedResultSchema,
	]),
);

export type EnqueueSandboxBody = z.infer<typeof enqueueSandboxBody>;
export type PollSandboxResult = z.infer<
	typeof pollSandboxResultResponseSchema.shape.data
>;
