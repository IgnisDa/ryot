import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

export const consumptionBasisField = {
	type: "object" as const,
	unknownKeys: "strict" as const,
	label: "Recorded estimation basis",
	description: "Metadata available when consumption was recorded; an absent total remains unknown",
	properties: {
		total: {
			label: "Total",
			type: "number" as const,
			validation: { minimum: 0 },
			description: "Frozen metadata amount",
		},
		unit: {
			label: "Unit",
			type: "enum" as const,
			description: "Consumption unit",
			validation: { required: true as const },
			choices: {
				kind: "static" as const,
				values: ["minutes", "pages", "episodes", "chapters"].map((value) => ({ value })),
			},
		},
		property: {
			type: "enum" as const,
			label: "Metadata property",
			description: "Source of the frozen estimate",
			choices: {
				kind: "static" as const,
				values: ["runtime", "duration", "lengthMinutes", "pages", "episodes", "chapters"].map(
					(value) => ({ value }),
				),
			},
		},
	},
};

export const calendarDateField = {
	type: "date" as const,
	label: "Calendar date",
	description: "Recorded YYYY-MM-DD date without time-of-day evidence",
};

export const consumedItemField = (entitySchemaSlug: "anime" | "manga") => ({
	label: "Consumed item",
	type: "object" as const,
	unknownKeys: "strict" as const,
	validation: { required: true as const },
	description: "One independent numbered occurrence, not cumulative progress or title completion",
	properties: {
		volume: {
			type: "number" as const,
			label: "Volume context",
			validation: { minimum: 0 },
			description: "Containing volume, not a consumed volume count",
		},
		position: {
			label: "Item number",
			type: "number" as const,
			validation: { minimum: 0, required: true as const },
			description: "Number identifying the item, never a consumed quantity",
		},
		unit: {
			label: "Item unit",
			type: "enum" as const,
			validation: { required: true as const },
			description: "Unit of this single occurrence",
			choices: {
				kind: "static" as const,
				values: (entitySchemaSlug === "anime" ? ["episodes"] : ["chapters", "volumes"]).map(
					(value) => ({ value }),
				),
			},
		},
	},
});

export const sourceProgressField = {
	type: "object" as const,
	unknownKeys: "strict" as const,
	label: "Original source progress",
	description: "Uninterpreted source position and percent; these do not establish consumed units",
	properties: {
		position: {
			type: "number" as const,
			label: "Source position",
			description: "Unmodified source position",
			validation: { minimum: 0, required: true as const },
		},
		percent: {
			type: "number" as const,
			label: "Source percent",
			description: "Unmodified source percent",
			validation: { minimum: 0, maximum: 100, required: true as const },
		},
		unit: {
			label: "Source unit",
			type: "enum" as const,
			description: "Source position unit",
			validation: { required: true as const },
			choices: {
				kind: "static" as const,
				values: [{ value: "episodes" }, { value: "chapters" }, { value: "volumes" }],
			},
		},
	},
};

export const withConsumptionFacts = (schema: AppSchema): AppSchema => ({
	...schema,
	fields: {
		sourceProgress: sourceProgressField,
		dateUnknown: {
			type: "boolean",
			label: "Date unknown",
			description: "No reliable consumption date; occurredAt is ordering evidence only",
		},
		sourceRun: {
			type: "string",
			label: "Source run",
			validation: { minLength: 1, maxLength: 200 },
			description:
				"Source-provided identity shared by observations in one independent consumption run",
		},
		...schema.fields,
		calendarDate: calendarDateField,
		consumptionBasis: consumptionBasisField,
	},
});
