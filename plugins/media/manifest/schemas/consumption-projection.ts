import type { AppSchema } from "@ryot-app/contract/schema/property-schema";

import { consumptionEventSlugs } from "../../shared/consumption-projection";

const number = (label: string) => ({
	label,
	description: label,
	type: "number" as const,
	validation: { minimum: 0, required: true as const },
});
const boolean = (label: string) => ({
	label,
	description: label,
	type: "boolean" as const,
	validation: { required: true as const },
});
const measure = (label: string) => ({
	label,
	description: label,
	type: "object" as const,
	unknownKeys: "strict" as const,
	properties: {
		recorded: number("Recorded amount"),
		missing: boolean("Missing quantity"),
		estimated: number("Estimated amount"),
		supersededEstimate: boolean("Superseded estimate"),
	},
});
const propertiesSchema: AppSchema = {
	unknownKeys: "strict",
	fields: {
		contribution: {
			type: "object",
			unknownKeys: "strict",
			validation: { required: true },
			label: "Consumption contribution",
			description: "Repaired quantities and activity attribution",
			properties: {
				pages: measure("Pages"),
				minutes: measure("Minutes"),
				volumes: measure("Volumes"),
				episodes: measure("Episodes"),
				chapters: measure("Chapters"),
				titleCompletions: number("Title completions"),
				activeObservation: boolean("Active observation"),
				episodeCompletions: number("Episode completions"),
				attribution: {
					type: "object",
					unknownKeys: "strict",
					label: "Date attribution",
					validation: { required: true },
					description: "Retained date precision",
					properties: {
						value: {
							label: "Date",
							type: "string",
							description: "Calendar date or observed instant",
						},
						kind: {
							type: "enum",
							label: "Precision",
							description: "Date precision",
							validation: { required: true },
							choices: {
								kind: "static",
								values: ["unknown", "date", "instant"].map((value) => ({ value })),
							},
						},
					},
				},
			},
		},
	},
};

export const mediaConsumptionProjection = (eventSlug: string) => ({
	propertiesSchema,
	scriptSlug: "script.media-consumption-step",
	inputs: [
		{ scope: { property: "entityId" }, eventSchemaSlug: "completion-occurrence" },
		...consumptionEventSlugs
			.filter((slug) => slug !== eventSlug)
			.map((eventSchemaSlug) => ({ eventSchemaSlug, scope: "entity" as const })),
	],
});

export const hasConsumptionProjection = (slug: string) =>
	consumptionEventSlugs.some((value) => value === slug);
