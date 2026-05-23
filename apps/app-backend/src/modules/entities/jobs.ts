import { z } from "@hono/zod-openapi";

import { nonEmptyStringSchema } from "~/lib/zod";

export const entityImportJobName = "import";

export const entityImportWaitingForSandboxStep = "waiting_for_sandbox";

export const entityImportJobData = z.object({
	userId: nonEmptyStringSchema,
	scriptId: nonEmptyStringSchema,
	externalId: nonEmptyStringSchema,
	entitySchemaId: nonEmptyStringSchema,
	step: z.literal(entityImportWaitingForSandboxStep).optional(),
});

export type EntityImportJobData = z.infer<typeof entityImportJobData>;
