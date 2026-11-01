import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

import {
	ConsumedItemUnit,
	ConsumptionBasisProperty,
	ConsumptionUnit,
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

const itemPositionField = {
	label: "Item number",
	validation: { minimum: 0, required: true as const },
	description: "Number identifying the item, never a consumed quantity",
};

const itemUnitField = (units: ReadonlyArray<typeof ConsumedItemUnit.Type>) => ({
	label: "Item unit",
	type: "enum" as const,
	choices: staticChoices(units),
	validation: { required: true as const },
	description: "Unit of this single occurrence",
});

export const consumedItemField = (entitySchemaSlug: "anime" | "manga") => {
	const properties: AppSchema["fields"] =
		entitySchemaSlug === "anime"
			? { unit: itemUnitField(["episodes"]), position: { ...itemPositionField, type: "integer" } }
			: {
					unit: itemUnitField(["chapters", "volumes"]),
					position: { ...itemPositionField, type: "number" },
					volume: {
						type: "number",
						label: "Volume context",
						validation: { minimum: 0 },
						description: "Containing volume, not a consumed volume count",
					},
				};
	return {
		properties,
		label: "Consumed item",
		type: "object" as const,
		unknownKeys: "strict" as const,
		validation: { required: true as const },
		description: "One independent numbered occurrence, not cumulative progress or title completion",
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
			choices: staticChoices(ConsumedItemUnit.literals),
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
