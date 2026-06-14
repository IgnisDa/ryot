import type { AppPropertyDefinition } from "./property-schema";

export * from "./property-schema";
export * from "./property-schema-runtime";

export const stringField = (label: string, description: string): AppPropertyDefinition => ({
	label,
	description,
	type: "string",
});

export const integerField = (label: string, description: string): AppPropertyDefinition => ({
	label,
	description,
	type: "integer",
});

export const numberField = (label: string, description: string): AppPropertyDefinition => ({
	label,
	description,
	type: "number",
});

export const booleanField = (label: string, description: string): AppPropertyDefinition => ({
	label,
	description,
	type: "boolean",
});

export const datetimeField = (label: string, description: string): AppPropertyDefinition => ({
	label,
	description,
	type: "datetime",
});

export const stringArrayField = (label: string, description: string): AppPropertyDefinition => ({
	label,
	description,
	type: "array",
	items: { type: "string", label: "Item", description: "Item" },
});

export const imageItemSchema: AppPropertyDefinition = {
	label: "Item",
	type: "object",
	description: "Item",
	unknownKeys: "strict",
	properties: {
		key: { type: "string", label: "Key", description: "Key" },
		url: { type: "string", label: "Url", description: "Url" },
		type: {
			type: "enum",
			label: "Type",
			description: "Type",
			options: ["s3", "remote"],
			validation: { required: true },
		},
	},
};

export const imagesField = (description: string): AppPropertyDefinition => ({
	description,
	type: "array",
	label: "Images",
	items: imageItemSchema,
});

export const mediaBaseFields = {
	genres: stringArrayField("Genres", "List of genres this media is categorized under"),
	publishYear: integerField("Publish Year", "Year this media was first published or released"),
	sourceUrl: stringField("Source Url", "Link to the original source or external provider page"),
	description: stringField("Description", "Synopsis or overview provided by the data provider"),
	isNsfw: booleanField("Is Nsfw", "Whether this media contains adult or not-safe-for-work content"),
	providerRating: numberField("Provider Rating", "Aggregate score from the external data provider"),
	publishDate: stringField(
		"Publish Date",
		"Exact date this media was first published or released, as an ISO 8601 date string (YYYY-MM-DD)",
	),
	productionStatus: stringField(
		"Production Status",
		"Current production status (e.g. Ended, Continuing, Cancelled)",
	),
};

export const unlinkedCreatorItemSchema: AppPropertyDefinition = {
	label: "Item",
	type: "object",
	description: "Item",
	unknownKeys: "strict",
	properties: {
		name: {
			label: "Name",
			type: "string",
			description: "Name",
			validation: { required: true },
		},
		role: {
			label: "Role",
			type: "string",
			description: "Role",
			validation: { required: true },
		},
	},
};

export const mediaWithCreatorsBaseFields = {
	...mediaBaseFields,
	unlinkedCreators: {
		type: "array",
		label: "Unlinked Creators",
		description: "Unlinked Creators",
		items: unlinkedCreatorItemSchema,
	} satisfies AppPropertyDefinition,
};
