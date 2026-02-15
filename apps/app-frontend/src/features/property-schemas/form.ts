import type { AppSchema } from "@ryot/ts-utils";
import {
	appPropertyPrimitiveTypes,
	trimmedOrUndefined,
	zodNonEmptyTrimmedString,
	zodRequiredName,
} from "@ryot/ts-utils";
import { z } from "zod";
import { resolveNextSlug } from "../../lib/slug-sync";

export const propertySchemaTypes = appPropertyPrimitiveTypes;

const propertySchemaTypeSchema = z.enum(propertySchemaTypes);

const propertySchemaBaseSchema = z.object({
	key: z.string(),
	required: z.boolean(),
	type: propertySchemaTypeSchema,
	label: zodNonEmptyTrimmedString("Label is required"),
	description: zodNonEmptyTrimmedString("Description is required"),
});

const propertySchemaRowSchema = propertySchemaBaseSchema.extend({
	id: z.string(),
});

const propertySchemaInputSchema = propertySchemaBaseSchema.extend({
	id: z.string().optional(),
});

export type PropertySchemaType = z.infer<typeof propertySchemaTypeSchema>;

export type PropertySchemaRow = z.infer<typeof propertySchemaRowSchema>;

export type PropertySchemaInput = z.infer<typeof propertySchemaInputSchema>;

function buildPropertySchemaRow(row: PropertySchemaInput): PropertySchemaRow {
	return {
		key: row.key,
		type: row.type,
		label: row.label,
		description: row.description,
		required: row.required,
		id: row.id ?? crypto.randomUUID(),
	};
}

export function buildDefaultPropertySchemaRow(): PropertySchemaRow {
	return buildPropertySchemaRow({
		key: "",
		label: "",
		description: "",
		type: "string",
		required: false,
	});
}

export function isPropertySchemaRowsValid(rows: PropertySchemaInput[]) {
	if (rows.length === 0) {
		return false;
	}

	const keys = rows.map((row) => row.key.trim());

	if (keys.some((key) => key.length === 0)) {
		return false;
	}

	return new Set(keys).size === keys.length;
}

export const createPropertySchemaFormSchema = z.object({
	name: zodRequiredName,
	slug: z.string(),
	properties: z
		.array(propertySchemaRowSchema)
		.refine(
			(properties) => isPropertySchemaRowsValid(properties),
			"Properties must contain unique non-empty keys",
		),
});

export type CreatePropertySchemaFormValues = z.infer<
	typeof createPropertySchemaFormSchema
>;

type PropertySchemaFormInput = Partial<
	Omit<CreatePropertySchemaFormValues, "properties">
> & {
	properties?: PropertySchemaInput[];
};

export function buildPropertySchemaFormValues(
	values?: PropertySchemaFormInput,
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
	const fields: AppSchema["fields"] = {};

	for (const property of properties) {
		const key = property.key.trim();
		const propertyDef: AppSchema["fields"][string] = {
			type: property.type,
			label: property.label.trim(),
			description: property.description.trim(),
		};

		if (property.required) {
			propertyDef.validation = { required: true };
		}

		fields[key] = propertyDef;
	}

	return { fields };
};

export const resolveNextPropertySchemaSlug = resolveNextSlug;

export const normalizeOptionalSlug = (slug: string) => trimmedOrUndefined(slug);
