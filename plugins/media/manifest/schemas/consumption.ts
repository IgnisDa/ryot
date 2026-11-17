import type {
	AuthoredAppSchema,
	ManifestText,
} from "@ryot-app/contract/modules/plugins/manifest-text";

import {
	ConsumptionBasisProperty,
	ConsumptionUnit,
	MediaPositionUnit,
	mediaPositionUnits,
} from "../../shared/consumption";
import { catalogMessage } from "../../shared/messages.generated";

const staticChoices = (values: ReadonlyArray<string>) => ({
	kind: "static" as const,
	values: values.map((value) => ({ value })),
});

export const consumptionBasisField = {
	type: "object" as const,
	unknownKeys: "strict" as const,
	label: catalogMessage("property.recorded-estimation-basis"),
	description: "Metadata available when consumption was recorded; an absent total remains unknown",
	properties: {
		total: {
			type: "number" as const,
			validation: { minimum: 0 },
			description: "Frozen metadata amount",
			label: catalogMessage("property.total"),
		},
		property: {
			type: "enum" as const,
			description: "Source of the frozen estimate",
			label: catalogMessage("property.metadata-property"),
			choices: staticChoices(ConsumptionBasisProperty.literals),
		},
		unit: {
			type: "enum" as const,
			description: "Consumption unit",
			label: catalogMessage("property.unit"),
			validation: { required: true as const },
			choices: staticChoices(ConsumptionUnit.literals),
		},
	},
};

export const calendarDateField = {
	type: "date" as const,
	label: catalogMessage("property.calendar-date"),
	description: "Recorded YYYY-MM-DD date without time-of-day evidence",
};

export const mediaPositionField = (
	entitySchemaSlug: "anime" | "manga",
	copy: { readonly required?: true; readonly label: ManifestText; readonly description: string },
) => {
	const units = mediaPositionUnits(entitySchemaSlug);
	const properties: AuthoredAppSchema["fields"] = {
		unit: {
			type: "enum",
			choices: staticChoices(units),
			validation: { required: true },
			label: catalogMessage("property.unit"),
			description: "Unit of the episode, chapter or volume number",
		},
		position: {
			label: catalogMessage("property.number"),
			validation: { minimum: 0, required: true },
			description: "Episode, chapter or volume number",
			type: entitySchemaSlug === "anime" ? "integer" : "number",
		},
		...(units.includes("chapters")
			? {
					volume: {
						type: "number",
						validation: { minimum: 0 },
						label: catalogMessage("property.volume-context"),
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
	label: catalogMessage("property.original-source-progress"),
	description: "Uninterpreted source position and percent; these do not establish consumed units",
	properties: {
		position: {
			type: "number" as const,
			description: "Unmodified source position",
			label: catalogMessage("property.source-position"),
			validation: { minimum: 0, required: true as const },
		},
		volume: {
			type: "number" as const,
			validation: { minimum: 0 },
			label: catalogMessage("property.source-volume-context"),
			description: "Unmodified containing volume of a source chapter",
		},
		percent: {
			type: "number" as const,
			description: "Unmodified source percent",
			label: catalogMessage("property.source-percent"),
			validation: { minimum: 0, maximum: 100, required: true as const },
		},
		unit: {
			type: "enum" as const,
			description: "Source position unit",
			validation: { required: true as const },
			label: catalogMessage("property.source-unit"),
			choices: staticChoices(MediaPositionUnit.literals),
		},
	},
};

export const withConsumptionFacts = (schema: AuthoredAppSchema): AuthoredAppSchema => ({
	...schema,
	fields: {
		sourceProgress: sourceProgressField,
		dateUnknown: {
			type: "boolean",
			label: catalogMessage("property.date-unknown"),
			description: "No reliable consumption date; occurredAt is ordering evidence only",
		},
		sourceRun: {
			type: "string",
			label: catalogMessage("property.source-run"),
			validation: { maxLength: 200, pattern: "\\S" },
			description:
				"Source-provided identity shared by observations in one independent consumption run",
		},
		...schema.fields,
		calendarDate: calendarDateField,
		consumptionBasis: consumptionBasisField,
	},
});
