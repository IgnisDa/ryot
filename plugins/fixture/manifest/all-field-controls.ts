import type { PluginEntitySchema } from "@ryot-app/contract/modules/plugins/manifest";
import { managedAssetItemSchema } from "@ryot-app/contract/schema/core";

export const allFieldControlsSchema = {
	icon: "list",
	eventSchemas: [],
	slug: "all-field-controls",
	name: "All field controls",
	editor: { relationships: [] },
	propertiesSchema: {
		fields: {
			text: { position: 0, label: "Text", type: "string", description: "Enter a text value." },
			date: { position: 8, type: "date", label: "Date", description: "Choose a calendar date." },
			integer: {
				position: 6,
				type: "integer",
				label: "Integer",
				description: "Enter a whole number.",
			},
			decimal: {
				position: 5,
				type: "number",
				label: "Decimal",
				description: "Enter a decimal number.",
			},
			enabled: {
				position: 7,
				type: "boolean",
				label: "Enabled",
				description: "Turn this option on or off.",
			},
			datetime: {
				position: 9,
				type: "datetime",
				label: "Date and time",
				description: "Choose a date and time.",
			},
			asset: {
				...managedAssetItemSchema,
				position: 16,
				label: "Asset",
				description: "Upload a single image or video.",
			},
			website: {
				position: 2,
				type: "string",
				label: "Website",
				format: { kind: "url" },
				description: "Enter a website URL.",
			},
			email: {
				position: 3,
				label: "Email",
				type: "string",
				format: { kind: "email" },
				description: "Enter an email address.",
			},
			secretText: {
				position: 1,
				secret: true,
				type: "string",
				label: "Secret text",
				description: "Enter a private text value.",
			},
			timezone: {
				position: 4,
				type: "string",
				label: "Timezone",
				format: { kind: "timezone" },
				description: "Choose a timezone.",
			},
			assets: {
				position: 17,
				type: "array",
				label: "Assets",
				items: managedAssetItemSchema,
				description: "Upload and reorder images or videos.",
			},
			tags: {
				position: 12,
				label: "Tags",
				type: "array",
				description: "Add a list of text tags.",
				items: { label: "Tag", type: "string", description: "A text list item" },
			},
			choice: {
				type: "enum",
				position: 10,
				label: "Choice",
				description: "Choose one option.",
				choices: {
					kind: "static",
					values: [
						{ value: "first", label: "First option" },
						{ value: "second", label: "Second option" },
					],
				},
			},
			choices: {
				position: 11,
				label: "Choices",
				type: "enum-array",
				description: "Choose one or more options.",
				choices: {
					kind: "static",
					values: [
						{ value: "first", label: "First option" },
						{ value: "second", label: "Second option" },
					],
				},
			},
			details: {
				position: 13,
				type: "object",
				label: "Details",
				description: "Enter structured details.",
				properties: {
					note: { label: "Note", type: "string", description: "Enter a detail note." },
					quantity: {
						type: "integer",
						label: "Quantity",
						description: "Enter a whole-number quantity.",
					},
				},
			},
			chipChoice: {
				type: "enum",
				position: 15,
				label: "Chip choice",
				description: "Choose one option from a chip group.",
				choices: {
					kind: "static",
					values: [
						{ value: "north", label: "North" },
						{ value: "south", label: "South" },
						{ value: "east", label: "East" },
						{ value: "west", label: "West" },
					],
				},
			},
			entries: {
				position: 14,
				type: "array",
				label: "Entries",
				description: "Add a list of structured entries.",
				items: {
					label: "Entry",
					type: "object",
					description: "A structured list item.",
					properties: {
						label: { label: "Label", type: "string", description: "Enter an entry label." },
						checked: {
							type: "boolean",
							label: "Checked",
							description: "Mark this entry as checked or unchecked.",
						},
					},
				},
			},
		},
	},
} satisfies PluginEntitySchema;
