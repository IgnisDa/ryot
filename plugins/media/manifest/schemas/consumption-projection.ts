import type {
	AuthoredAppSchema,
	ManifestText,
} from "@ryot-app/contract/modules/plugins/manifest-text";

import { consumptionEventSlugs } from "../../shared/consumption-projection";
import { catalogMessage } from "../../shared/messages.generated";

const number = (label: ManifestText, description: string) => ({
	label,
	description,
	type: "number" as const,
	validation: { minimum: 0, required: true as const },
});
const boolean = (label: ManifestText, description: string) => ({
	label,
	description,
	type: "boolean" as const,
	validation: { required: true as const },
});
const measure = (label: ManifestText, description: string) => ({
	label,
	description,
	type: "object" as const,
	unknownKeys: "strict" as const,
	properties: {
		recorded: number(catalogMessage("property.recorded-amount"), "Recorded amount"),
		missing: boolean(catalogMessage("property.missing-quantity"), "Missing quantity"),
		estimated: number(catalogMessage("property.estimated-amount"), "Estimated amount"),
		supersededEstimate: boolean(
			catalogMessage("property.superseded-estimate"),
			"Superseded estimate",
		),
	},
});
const propertiesSchema: AuthoredAppSchema = {
	unknownKeys: "strict",
	fields: {
		contribution: {
			type: "object",
			unknownKeys: "strict",
			validation: { required: true },
			label: catalogMessage("property.consumption-contribution"),
			description: "Repaired quantities and activity attribution",
			properties: {
				pages: measure(catalogMessage("property.pages"), "Pages"),
				minutes: measure(catalogMessage("property.minutes"), "Minutes"),
				volumes: measure(catalogMessage("property.volumes"), "Volumes"),
				episodes: measure(catalogMessage("property.episodes"), "Episodes"),
				chapters: measure(catalogMessage("property.chapters"), "Chapters"),
				titleCompletions: number(catalogMessage("property.title-completions"), "Title completions"),
				activeObservation: boolean(
					catalogMessage("property.active-observation"),
					"Active observation",
				),
				episodeCompletions: number(
					catalogMessage("property.episode-completions"),
					"Episode completions",
				),
				attribution: {
					type: "object",
					unknownKeys: "strict",
					validation: { required: true },
					description: "Retained date precision",
					label: catalogMessage("property.date-attribution"),
					properties: {
						value: {
							type: "string",
							label: catalogMessage("property.date"),
							description: "Calendar date or observed instant",
						},
						kind: {
							type: "enum",
							description: "Date precision",
							validation: { required: true },
							label: catalogMessage("property.precision"),
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

export const mediaConsumptionProjection = { propertiesSchema };

export const hasConsumptionProjection = (slug: string) =>
	consumptionEventSlugs.some((value) => value === slug);
