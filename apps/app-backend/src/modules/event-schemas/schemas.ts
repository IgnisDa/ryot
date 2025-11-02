import { z } from "zod";
import { dataSchema } from "~/lib/openapi";
import {
	createNameWithOptionalSlugSchema,
	nonEmptyTrimmedStringSchema,
} from "~/lib/zod/base";
import {
	createPropertySchemaInputSchema,
	createPropertySchemaObjectSchema,
} from "../property-schemas/schemas";

const eventSchemaPropertiesMessage =
	"Event schema properties must contain at least one property";

export const listedEventSchemaSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	entitySchemaId: z.string(),
	propertiesSchema: createPropertySchemaObjectSchema(
		eventSchemaPropertiesMessage,
	),
});

export const listEventSchemasResponseSchema = dataSchema(
	z.array(listedEventSchemaSchema),
);

export const createEventSchemaResponseSchema = dataSchema(
	listedEventSchemaSchema,
);

export const listEventSchemasQuery = z.object({
	entitySchemaId: nonEmptyTrimmedStringSchema,
});

export const createEventSchemaBody = createNameWithOptionalSlugSchema({
	entitySchemaId: nonEmptyTrimmedStringSchema,
	propertiesSchema: createPropertySchemaInputSchema(
		eventSchemaPropertiesMessage,
	),
});

export type CreateEventSchemaBody = z.infer<typeof createEventSchemaBody>;
