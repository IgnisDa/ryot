import { z } from "@hono/zod-openapi";
import { dataSchema, itemDataSchema } from "~/lib/openapi";
import {
	createIdParamsSchema,
	createNameWithOptionalSlugSchema,
	nonEmptyStringSchema,
	stringUnknownRecordSchema,
} from "~/lib/zod";

export const enqueueSandboxBody = z.object({
	scriptId: nonEmptyStringSchema,
	driverName: nonEmptyStringSchema,
	context: stringUnknownRecordSchema.optional(),
});

export const sandboxJobParams = createIdParamsSchema("jobId");

export const enqueueSandboxResponseSchema = dataSchema(
	z.object({ jobId: nonEmptyStringSchema }),
);

export type SandboxEnqueueResult = z.infer<
	typeof enqueueSandboxResponseSchema.shape.data
>;

export const createSandboxScriptBody = createNameWithOptionalSlugSchema({
	code: nonEmptyStringSchema.max(20_000),
});

const sandboxScriptSchema = z.object({
	id: nonEmptyStringSchema,
	name: nonEmptyStringSchema,
	slug: nonEmptyStringSchema,
	code: nonEmptyStringSchema,
});

export const createSandboxScriptResponseSchema =
	itemDataSchema(sandboxScriptSchema);

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

export type SandboxScript = z.infer<typeof sandboxScriptSchema>;
export type EnqueueSandboxBody = z.infer<typeof enqueueSandboxBody>;
export type CreateSandboxScriptBody = z.infer<typeof createSandboxScriptBody>;
export type PollSandboxResult = z.infer<
	typeof pollSandboxResultResponseSchema.shape.data
>;
