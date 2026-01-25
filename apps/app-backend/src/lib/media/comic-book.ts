import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableIntSchema } from "../zod/base";
import { mediaPropertiesSchema } from "./common";

export const comicBookPropertiesSchema = mediaPropertiesSchema.extend({
	pages: nullableIntSchema,
});

export const comicBookPropertiesJsonSchema = toAppSchemaProperties(
	comicBookPropertiesSchema,
);
