import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import { nonEmptyTrimmedStringSchema } from "~/lib/zod/base";
import { listedEntitySchema } from "../entities/schemas";

export const executeViewRuntimeBody = z.object({
	entitySchemaId: nonEmptyTrimmedStringSchema,
});

export const executeViewRuntimeResponseSchema = dataSchema(
	z.array(listedEntitySchema),
);
