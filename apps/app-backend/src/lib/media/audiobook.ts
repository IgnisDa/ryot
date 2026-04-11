import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema } from "../zod/base";
import { freeCreatorSchema, mediaPropertiesSchema } from "./common";

export const audiobookPropertiesSchema = mediaPropertiesSchema.extend({
	runtime: nullableIntSchema,
	freeCreators: z.array(freeCreatorSchema),
});

export const audiobookPropertiesJsonSchema = toAppSchemaProperties(
	audiobookPropertiesSchema,
);
