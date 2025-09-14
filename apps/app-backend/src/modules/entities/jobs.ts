import { z } from "@hono/zod-openapi";

import { nonEmptyStringSchema, positiveIntSchema } from "~/lib/zod";

export const entityImportJobName = "import";
export const entityPreloadJobName = "preload";
export const entityPreloadImportJobName = "preload-import";

export const entityImportWaitingForSandboxStep = "waiting_for_sandbox";
export const entityPreloadWaitingForSandboxStep = "waiting_for_sandbox";

export const entityImportJobData = z
	.object({
		userId: nonEmptyStringSchema,
		scriptId: nonEmptyStringSchema,
		externalId: nonEmptyStringSchema,
		entitySchemaId: nonEmptyStringSchema,
		step: z.literal(entityImportWaitingForSandboxStep).optional(),
	})
	.strict();

export const entityPreloadJobData = z.object({
	userId: nonEmptyStringSchema,
	scriptId: nonEmptyStringSchema,
	entitySchemaId: nonEmptyStringSchema,
	page: positiveIntSchema.default(1),
	pageSize: positiveIntSchema.default(100),
	step: z.literal(entityPreloadWaitingForSandboxStep).optional(),
});

export type EntityImportJobData = z.infer<typeof entityImportJobData>;
