export const createOptionalTitlePropertiesSchema = () => ({
	title: { type: "string" as const },
});

export const createRequiredTitlePropertiesSchema = () => ({
	title: { type: "string" as const, required: true as const },
});

export const createOptionalRatingPropertiesSchema = () => ({
	rating: { type: "number" as const },
});

export const createTitleAndPagesPropertiesSchema = () => ({
	pages: { type: "integer" as const },
	title: { type: "string" as const, required: true as const },
});

export const createNoteAndRatingPropertiesSchema = () => ({
	note: { type: "string" as const },
	rating: { type: "number" as const, required: true as const },
});

export const createFlatTitlePagesPropertySchema = () => ({
	title: { type: "string" as const },
	pages: { type: "integer" as const },
});

export const createFlatNoteProgressPropertySchema = () => ({
	note: { type: "string" as const },
	progress: { type: "integer" as const },
});

export const createProgressPercentPropertiesSchema = () => ({
	progressPercent: { type: "number" as const, required: true as const },
});

export const createNestedMetadataPropertiesSchema = () => ({
	metadata: {
		type: "object" as const,
		properties: {
			year: { type: "integer" as const },
			author: { type: "string" as const },
		},
	},
});

export const createNestedPeoplePropertySchema = () => ({
	people: {
		type: "array" as const,
		items: {
			type: "object" as const,
			properties: {
				role: { type: "string" as const },
				identifier: { type: "string" as const },
			},
		},
	},
});

export const createNestedMatrixPropertySchema = () => ({
	matrix: {
		type: "array" as const,
		items: {
			type: "array" as const,
			items: { type: "number" as const },
		},
	},
});
