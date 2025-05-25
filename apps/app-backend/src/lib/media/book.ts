import { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableBooleanSchema, nullableIntSchema } from "../zod/base";
import { freeCreatorSchema, mediaPropertiesSchema } from "./common";

export const personStubSchema = z
	.object({
		role: z.string(),
		name: z.string(),
		scriptSlug: z.string(),
		identifier: z.string(),
		character: z.string().optional(),
		order: z.number().int().optional(),
	})
	.strict();

export type PersonStub = z.infer<typeof personStubSchema>;

export const bookPropertiesSchema = mediaPropertiesSchema.extend({
	pages: nullableIntSchema,
	isCompilation: nullableBooleanSchema,
	freeCreators: z.array(freeCreatorSchema),
});

export const bookPropertiesJsonSchema =
	toAppSchemaProperties(bookPropertiesSchema);
