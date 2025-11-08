import type { AppPropertyPrimitiveType, AppSchema } from "@ryot/ts-utils";
import {
	appPropertyPrimitiveTypes,
	trimmedOrUndefined,
	zodRequiredName,
} from "@ryot/ts-utils";
import { z } from "zod";
import {
	type ResolveNextSlugInput,
	resolveNextSlug,
} from "../../lib/slug-sync";

export const propertySchemaTypes = appPropertyPrimitiveTypes;

export type PropertySchemaType = AppPropertyPrimitiveType;

interface PropertySchemaBase {
	key: string;
	required: boolean;
	type: PropertySchemaType;
}

export interface PropertySchemaRow extends PropertySchemaBase {
	id: string;
}

export interface PropertySchemaInput extends PropertySchemaBase {
	id?: string;
}

export interface PropertySchemaFormValues {
	name: string;
	slug: string;
	properties: PropertySchemaInput[];
}

export type ResolveNextPropertySchemaSlugInput = ResolveNextSlugInput;

function buildPropertySchemaRow(row: PropertySchemaInput): PropertySchemaRow {
	return {
		key: row.key,
		type: row.type,
		required: row.required,
		id: row.id ?? crypto.randomUUID(),
	};
}

export function buildDefaultPropertySchemaRow(): PropertySchemaRow {
	return buildPropertySchemaRow({
		key: "",
		type: "string",
		required: false,
	});
}

export function isPropertySchemaRowsValid(rows: PropertySchemaInput[]) {
	if (rows.length === 0) return false;

	const keys = rows.map((row) => row.key.trim());

	if (keys.some((key) => key.length === 0)) return false;

	return new Set(keys).size === keys.length;
}

export const createPropertySchemaFormSchema = z.object({
	name: zodRequiredName,
	slug: z.string(),
	properties: z
		.array(
			z.object({
				id: z.string(),
				key: z.string(),
				required: z.boolean(),
				type: z.enum(propertySchemaTypes),
			}),
		)
		.refine(
			(properties) => isPropertySchemaRowsValid(properties),
			"Properties must contain unique non-empty keys",
		),
});

export type CreatePropertySchemaFormValues = z.infer<
	typeof createPropertySchemaFormSchema
>;

export function buildPropertySchemaFormValues(
	values?: Partial<PropertySchemaFormValues>,
): CreatePropertySchemaFormValues {
	const properties = values?.properties;

	return {
		name: values?.name ?? "",
		slug: values?.slug ?? "",
		properties:
			properties && properties.length > 0
				? properties.map(buildPropertySchemaRow)
				: [buildDefaultPropertySchemaRow()],
	};
}

export const defaultCreatePropertySchemaFormValues =
	buildPropertySchemaFormValues();

export const buildPropertiesSchema = (properties: PropertySchemaInput[]) => {
	const propertiesMap: AppSchema = {};

	for (const property of properties) {
		const key = property.key.trim();
		const propertyDef: AppSchema[string] = { type: property.type };

		if (property.required) propertyDef.required = true;

		propertiesMap[key] = propertyDef;
	}

	return propertiesMap;
};

export const resolveNextPropertySchemaSlug = resolveNextSlug;

export const normalizeOptionalSlug = (slug: string) => trimmedOrUndefined(slug);
