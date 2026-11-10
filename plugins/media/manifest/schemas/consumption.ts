import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

import {
	ConsumptionBasisProperty,
	ConsumptionUnit,
	MediaPositionUnit,
	mediaPositionUnits,
} from "../../shared/consumption";

const staticChoices = (values: ReadonlyArray<string>) => ({
	kind: "static" as const,
	values: values.map((value) => ({ value })),
});

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
		property: {
			type: "enum" as const,
			label: "Metadata property",
			description: "Source of the frozen estimate",
			choices: staticChoices(ConsumptionBasisProperty.literals),
		},
		unit: {
			label: "Unit",
			type: "enum" as const,
			description: "Consumption unit",
			validation: { required: true as const },
			choices: staticChoices(ConsumptionUnit.literals),
		},
	},
};

export const calendarDateField = {
	type: "date" as const,
	label: "Calendar date",
	description: "Recorded YYYY-MM-DD date without time-of-day evidence",
};

export const mediaPositionField = (
	entitySchemaSlug: "anime" | "manga",
	eventSchemaSlug: string,
	copy: { readonly label: string; readonly required?: true; readonly description: string },
) => {
	const units = mediaPositionUnits(entitySchemaSlug, eventSchemaSlug);
	const properties: AppSchema["fields"] = {
		unit: {
			type: "enum",
			label: "Unit",
			choices: staticChoices(units),
			validation: { required: true },
			description: "Unit of the episode, chapter or volume number",
		},
		position: {
			label: "Number",
			validation: { minimum: 0, required: true },
			description: "Episode, chapter or volume number",
			type: entitySchemaSlug === "anime" ? "integer" : "number",
		},
		...(units.includes("chapters")
			? {
					volume: {
						type: "number",
						label: "Volume context",
						validation: { minimum: 0 },
						description: "Containing volume of a chapter, not a consumed volume count",
					},
				}
			: {}),
	};
	return {
		properties,
		label: copy.label,
		type: "object" as const,
		description: copy.description,
		unknownKeys: "strict" as const,
		...(copy.required ? { validation: { required: true as const } } : {}),
	};
};

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
		volume: {
			type: "number" as const,
			validation: { minimum: 0 },
			label: "Source volume context",
			description: "Unmodified containing volume of a source chapter",
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
			choices: staticChoices(MediaPositionUnit.literals),
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
			validation: { maxLength: 200, pattern: "\\S" },
			description:
				"Source-provided identity shared by observations in one independent consumption run",
		},
		...schema.fields,
		calendarDate: calendarDateField,
		consumptionBasis: consumptionBasisField,
	},
});
