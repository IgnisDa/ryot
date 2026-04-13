import { z } from "@hono/zod-openapi";
import { nonEmptyStringSchema } from "~/lib/zod";

export const mediaImportJobName = "media-import";

export const mediaImportJobData = z.object({
	userId: nonEmptyStringSchema,
	scriptId: nonEmptyStringSchema,
	identifier: nonEmptyStringSchema,
	entitySchemaId: nonEmptyStringSchema,
});

export type MediaImportJobData = z.infer<typeof mediaImportJobData>;

export const personPopulateJobName = "person-populate";

export const personPopulateJobData = z.object({
	userId: nonEmptyStringSchema,
	scriptSlug: nonEmptyStringSchema,
	identifier: nonEmptyStringSchema,
	personEntityId: nonEmptyStringSchema,
});

export type PersonPopulateJobData = z.infer<typeof personPopulateJobData>;
