import { managedAssetItemSchema } from "@ryot/contract/schema/core";
import type { AppPropertyDefinition, AppSchema } from "@ryot/contract/schema/property-schema";

const imagePurposes = ["cover", "backdrop", "profile", "still"] as const;

const images = {
	type: "array",
	label: "Images",
	translatable: true,
	description: "Fixture images",
	items: {
		...managedAssetItemSchema,
		properties: {
			...managedAssetItemSchema.properties,
			purpose: {
				type: "enum",
				label: "Purpose",
				description: "Purpose",
				validation: { required: true },
				choices: { kind: "static", values: imagePurposes.map((value) => ({ value })) },
			},
		},
	},
} satisfies AppPropertyDefinition;

export const fixtureMediaPropertiesSchema: AppSchema = {
	fields: {
		images,
		runtime: { type: "integer", label: "Runtime", description: "Runtime" },
		description: {
			type: "string",
			translatable: true,
			label: "Description",
			description: "Description",
		},
		genres: {
			type: "array",
			label: "Genres",
			description: "Genres",
			items: { type: "string", label: "Genre", description: "Genre" },
		},
	},
};

export const fixturePersonPropertiesSchema: AppSchema = {
	fields: {
		images,
		name: { type: "string", label: "Name", description: "Name" },
		description: {
			type: "string",
			translatable: true,
			label: "Description",
			description: "Description",
		},
	},
};

export const fixtureEntityPropertiesSchema: AppSchema = {
	fields: {
		name: { label: "Name", type: "string", description: "Name", validation: { required: true } },
	},
};
