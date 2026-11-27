import type { PluginEntitySchema } from "@ryot-app/contract/modules/plugins/manifest";
import { managedAssetItemSchema } from "@ryot-app/contract/schema/core";

import { catalogMessage } from "../shared/messages.generated";

export const allFieldControlsSchema = {
	icon: "list",
	eventSchemas: [],
	slug: "all-field-controls",
	editor: { relationships: [] },
	name: catalogMessage("entity-schema.all-field-controls.name"),
	propertiesSchema: {
		fields: {
			text: {
				position: 0,
				type: "string",
				description: "Enter a text value.",
				label: catalogMessage("property.text"),
			},
			date: {
				position: 8,
				type: "date",
				label: catalogMessage("property.date"),
				description: "Choose a calendar date.",
			},
			integer: {
				position: 6,
				type: "integer",
				description: "Enter a whole number.",
				label: catalogMessage("property.integer"),
				hint: catalogMessage("property.integer-hint"),
			},
			decimal: {
				position: 5,
				type: "number",
				description: "Enter a decimal number.",
				label: catalogMessage("property.decimal"),
				hint: catalogMessage("property.decimal-hint"),
			},
			enabled: {
				position: 7,
				type: "boolean",
				label: catalogMessage("property.enabled"),
				description: "Turn this option on or off.",
				hint: catalogMessage("property.enabled-hint"),
			},
			asset: {
				...managedAssetItemSchema,
				position: 16,
				label: catalogMessage("property.asset"),
				hint: catalogMessage("property.asset-hint"),
				description: "Upload a single image or video.",
			},
			datetime: {
				position: 9,
				type: "datetime",
				description: "Choose a date and time.",
				label: catalogMessage("property.date-and-time"),
				hint: catalogMessage("property.date-and-time-hint"),
			},
			email: {
				position: 3,
				type: "string",
				format: { kind: "email" },
				description: "Enter an email address.",
				label: catalogMessage("property.email"),
				hint: catalogMessage("property.email-hint"),
			},
			website: {
				position: 2,
				type: "string",
				format: { kind: "url" },
				description: "Enter a website URL.",
				label: catalogMessage("property.website"),
				hint: catalogMessage("property.website-hint"),
			},
			timezone: {
				position: 4,
				type: "string",
				format: { kind: "timezone" },
				description: "Choose a timezone.",
				label: catalogMessage("property.timezone"),
				hint: catalogMessage("property.timezone-hint"),
			},
			secretText: {
				position: 1,
				secret: true,
				type: "string",
				description: "Enter a private text value.",
				label: catalogMessage("property.secret-text"),
				hint: catalogMessage("property.secret-text-hint"),
			},
			assets: {
				position: 17,
				type: "array",
				items: managedAssetItemSchema,
				label: catalogMessage("property.assets"),
				hint: catalogMessage("property.assets-hint"),
				description: "Upload and reorder images or videos.",
			},
			tags: {
				position: 12,
				type: "array",
				label: catalogMessage("property.tags"),
				description: "Add a list of text tags.",
				hint: catalogMessage("property.tags-hint"),
				items: {
					type: "string",
					description: "A text list item",
					label: catalogMessage("property.tag"),
				},
			},
			choice: {
				type: "enum",
				position: 10,
				description: "Choose one option.",
				label: catalogMessage("property.choice"),
				hint: catalogMessage("property.choice-hint"),
				choices: {
					kind: "static",
					values: [
						{ value: "first", label: catalogMessage("choice.first-option") },
						{ value: "second", label: catalogMessage("choice.second-option") },
					],
				},
			},
			choices: {
				position: 11,
				type: "enum-array",
				label: catalogMessage("property.choices"),
				description: "Choose one or more options.",
				hint: catalogMessage("property.choices-hint"),
				choices: {
					kind: "static",
					values: [
						{ value: "first", label: catalogMessage("choice.first-option") },
						{ value: "second", label: catalogMessage("choice.second-option") },
					],
				},
			},
			chipChoice: {
				type: "enum",
				position: 15,
				label: catalogMessage("property.chip-choice"),
				hint: catalogMessage("property.chip-choice-hint"),
				description: "Choose one option from a chip group.",
				choices: {
					kind: "static",
					values: [
						{ value: "north", label: catalogMessage("choice.north") },
						{ value: "south", label: catalogMessage("choice.south") },
						{ value: "east", label: catalogMessage("choice.east") },
						{ value: "west", label: catalogMessage("choice.west") },
					],
				},
			},
			details: {
				position: 13,
				type: "object",
				description: "Enter structured details.",
				label: catalogMessage("property.details"),
				hint: catalogMessage("property.details-hint"),
				properties: {
					note: {
						type: "string",
						description: "Enter a detail note.",
						label: catalogMessage("property.note"),
					},
					quantity: {
						type: "integer",
						label: catalogMessage("property.quantity"),
						description: "Enter a whole-number quantity.",
						hint: catalogMessage("property.quantity-hint"),
					},
				},
			},
			entries: {
				position: 14,
				type: "array",
				label: catalogMessage("property.entries"),
				hint: catalogMessage("property.entries-hint"),
				description: "Add a list of structured entries.",
				items: {
					type: "object",
					description: "A structured list item.",
					label: catalogMessage("property.entry"),
					hint: catalogMessage("property.entry-hint"),
					properties: {
						label: {
							type: "string",
							description: "Enter an entry label.",
							label: catalogMessage("property.label"),
						},
						checked: {
							type: "boolean",
							label: catalogMessage("property.checked"),
							hint: catalogMessage("property.checked-hint"),
							description: "Mark this entry as checked or unchecked.",
						},
					},
				},
			},
		},
	},
} satisfies PluginEntitySchema;
