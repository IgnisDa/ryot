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

function isPrimitiveProperty(propertyDef: AppPropertyDefinition) {
	return match(propertyDef.type)
		.with(
			"enum",
			"date",
			"boolean",
			"string",
			"number",
			"integer",
			"datetime",
			"enum-array",
			() => true,
		)
		.otherwise(() => false);
}

function getUnsupportedRequiredProperties(schema: AppSchema): string[] {
	return Object.entries(schema.fields)
		.filter(
			([, propertyDef]) =>
				isAppPropertyRequired(propertyDef) && !isPrimitiveProperty(propertyDef),
		)
		.map(([key]) => key);
}

function getUnsupportedRequiredPropertiesMessage(
	propertyKeys: string[],
): string {
	return `This entity schema requires unsupported properties: ${propertyKeys.join(", ")}.`;
}

const buildEntityPropertiesSchema = (propertiesSchema: AppSchema) => {
	const fields: AppSchema["fields"] = {};
	const supportedKeys = new Set<string>();

	for (const [key, propertyDef] of Object.entries(propertiesSchema.fields)) {
		if (!isPrimitiveProperty(propertyDef)) {
			continue;
		}

		supportedKeys.add(key);
		fields[key] = propertyDef;
	}

	return fromAppSchemaObject(
		{
			fields,
			rules: propertiesSchema.rules,
		},
		{ unknownKeys: "strip" },
	);
};

export const buildCreateEntityFormSchema = (propertiesSchema: AppSchema) => {
	return z
		.object({
			name: zodRequiredName,
			image: entityImageSchema,
			properties: z.record(z.string(), z.unknown()),
		})
		.superRefine((value, ctx) => {
			const unsupportedRequiredProperties =
				getUnsupportedRequiredProperties(propertiesSchema);
			if (unsupportedRequiredProperties.length > 0) {
				ctx.addIssue({
					code: "custom",
					path: ["properties"],
					message: getUnsupportedRequiredPropertiesMessage(
						unsupportedRequiredProperties,
					),
				});
			}

			const result = buildEntityPropertiesSchema(propertiesSchema).safeParse(
				value.properties,
			);

			if (result.success) {
				return;
			}

			for (const issue of result.error.issues) {
				ctx.addIssue({
					...issue,
					path: ["properties", ...issue.path],
				});
			}
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
		.with({ type: "enum" }, () => "")
		.with({ type: "number" }, { type: "integer" }, () => 0)
		.with({ type: "boolean" }, () => false)
		.with({ type: "array" }, { type: "enum-array" }, () => [])
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
	propertiesSchema: AppSchema,
): CreateEntityPayload {
	const properties = buildEntityPropertiesSchema(propertiesSchema).parse(
		input.properties,
	);

	return {
		entitySchemaId,
		image: input.image,
		name: input.name.trim(),
		properties,
	};
}
