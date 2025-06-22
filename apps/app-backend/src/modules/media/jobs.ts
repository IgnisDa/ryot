import { z } from "@hono/zod-openapi";
import { nonEmptyStringSchema } from "~/lib/zod/base";

export const mediaImportJobName = "media-import";

export const mediaImportJobData = z.object({
	userId: nonEmptyStringSchema,
	scriptId: nonEmptyStringSchema,
	identifier: nonEmptyStringSchema,
	entitySchemaId: nonEmptyStringSchema,
});

export type MediaImportJobData = z.infer<typeof mediaImportJobData>;
