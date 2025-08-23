import type { z } from "@hono/zod-openapi";
import { toAppSchemaProperties } from "@ryot/ts-utils";
import { nullableBooleanSchema, nullableIntSchema } from "../zod/base";
import { mediaPropertiesSchema } from "./common";

// duration is in seconds
export const musicPropertiesSchema = mediaPropertiesSchema.extend({
	duration: nullableIntSchema,
	byVariousArtists: nullableBooleanSchema,
});

export const musicPropertiesJsonSchema = toAppSchemaProperties(
	musicPropertiesSchema,
);

export type MusicProperties = z.infer<typeof musicPropertiesSchema>;
