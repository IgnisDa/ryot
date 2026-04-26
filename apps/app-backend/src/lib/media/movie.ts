import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema } from "../zod";
import { freeCreatorSchema, mediaPropertiesSchema } from "./common";

export const moviePropertiesSchema = mediaPropertiesSchema.extend({
	runtime: nullableIntSchema,
	freeCreators: z.array(freeCreatorSchema),
});

export const moviePropertiesJsonSchema = toAppSchemaProperties(
	moviePropertiesSchema,
);
