import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils";
import {
	fromAppSchemaObject,
	isAppPropertyRequired,
	zodRequiredName,
} from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { z } from "zod";
import type { ApiPostRequestBody } from "~/lib/api/types";

const entityImageSchema = z.union([
	z.object({ kind: z.literal("s3"), key: z.string() }),
	z.object({ kind: z.literal("remote"), url: z.string() }),
	z.null(),
	z.undefined(),
]);

export const buildCreateEntityFormSchema = (propertiesSchema: AppSchema) => {
	return z.object({
		name: zodRequiredName,
		image: entityImageSchema,
		properties: fromAppSchemaObject(propertiesSchema),
	});
};

export type CreateEntityFormValues = z.infer<
	ReturnType<typeof buildCreateEntityFormSchema>
>;

export const buildDefaultEntityFormValues = (
	propertiesSchema: AppSchema,
): CreateEntityFormValues => {
	const properties: Record<string, unknown> = {};

	for (const [key, propertyDef] of Object.entries(propertiesSchema.fields)) {
		if (isAppPropertyRequired(propertyDef)) {
			properties[key] = getDefaultValue(propertyDef);
		}
	}

	return { name: "", image: null, properties };
};

const getDefaultValue = (propertyDef: AppPropertyDefinition): unknown => {
	return match(propertyDef)
		.with({ type: "string" }, { type: "date" }, { type: "datetime" }, () => "")
		.with({ type: "number" }, { type: "integer" }, () => 0)
		.with({ type: "boolean" }, () => false)
		.with({ type: "array" }, () => [])
		.with({ type: "object" }, (def) => {
			const obj: Record<string, unknown> = {};
			for (const [key, nestedDef] of Object.entries(def.properties)) {
				obj[key] = getDefaultValue(nestedDef);
			}
			return obj;
		})
		.otherwise(() => null);
};

export type CreateEntityPayload = ApiPostRequestBody<"/entities">;

export function toCreateEntityPayload(
	input: CreateEntityFormValues,
	entitySchemaId: string,
): CreateEntityPayload {
	return {
		entitySchemaId,
		image: input.image,
		name: input.name.trim(),
		properties: input.properties,
	};
}
