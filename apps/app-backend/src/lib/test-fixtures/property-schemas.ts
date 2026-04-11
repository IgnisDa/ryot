export const createOptionalTitlePropertiesSchema = () => ({
	fields: { title: { type: "string" as const } },
});

export const createRequiredTitlePropertiesSchema = () => ({
	fields: {
		title: { type: "string" as const, validation: { required: true as const } },
	},
});

export const createOptionalRatingPropertiesSchema = () => ({
	fields: { rating: { type: "number" as const } },
});

export const createTitleAndPagesPropertiesSchema = () => ({
	fields: {
		pages: { type: "integer" as const },
		title: {
			type: "string" as const,
			validation: { required: true as const },
		},
	},
});

export const createNoteAndRatingPropertiesSchema = () => ({
	fields: {
		note: { type: "string" as const },
		rating: {
			type: "number" as const,
			validation: { required: true as const },
		},
	},
});

export const createTitlePagesPropertiesSchema = () => ({
	fields: {
		title: { type: "string" as const },
		pages: { type: "integer" as const },
	},
});

export const createNoteProgressPropertiesSchema = () => ({
	fields: {
		note: { type: "string" as const },
		progress: { type: "integer" as const },
	},
});

export const createProgressPercentPropertiesSchema = () => ({
	fields: {
		progressPercent: {
			type: "number" as const,
			transform: { round: { mode: "half_up" as const, scale: 2 } },
			validation: {
				exclusiveMinimum: 0,
				exclusiveMaximum: 100,
				required: true as const,
			},
		},
	},
});

export const createReviewPropertiesSchema = () => ({
	fields: {
		review: { type: "string" as const },
		rating: {
			type: "integer" as const,
			validation: { required: true as const, maximum: 5, minimum: 1 },
		},
	},
});

export const createNestedMetadataPropertiesSchema = () => ({
	fields: {
		metadata: {
			type: "object" as const,
			properties: {
				year: { type: "integer" as const },
				author: { type: "string" as const },
			},
		},
	},
});

export const createNestedPeoplePropertySchema = () => ({
	fields: {
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
	},
});

export const createNestedMatrixPropertySchema = () => ({
	fields: {
		matrix: {
			type: "array" as const,
			items: { type: "array" as const, items: { type: "number" as const } },
		},
	},
});
