import { z } from "@hono/zod-openapi";

import { nonEmptyStringSchema } from "~/lib/zod";

// TODO: Delete this file — superseded by ~/modules/entities/jobs.ts.
export const mediaImportJobName = "media-import";

export const mediaJobWaitingForSandboxStep = "waiting_for_sandbox";

export const mediaImportJobData = z.object({
	userId: nonEmptyStringSchema,
	scriptId: nonEmptyStringSchema,
	externalId: nonEmptyStringSchema,
	entitySchemaId: nonEmptyStringSchema,
	step: z.literal(mediaJobWaitingForSandboxStep).optional(),
});

export type MediaImportJobData = z.infer<typeof mediaImportJobData>;
