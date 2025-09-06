export const createOptionalTitlePropertiesSchema = () => ({
	fields: { title: { label: "Title", type: "string" as const } },
});

export const createRequiredTitlePropertiesSchema = () => ({
	fields: {
		title: {
			label: "Title",
			type: "string" as const,
			validation: { required: true as const },
		},
	},
});

export const createOptionalRatingPropertiesSchema = () => ({
	fields: { rating: { label: "Rating", type: "number" as const } },
});

export const createTitleAndPagesPropertiesSchema = () => ({
	fields: {
		pages: { label: "Pages", type: "integer" as const },
		title: {
			label: "Title",
			type: "string" as const,
			validation: { required: true as const },
		},
	},
});

export const createNoteAndRatingPropertiesSchema = () => ({
	fields: {
		note: { label: "Note", type: "string" as const },
		rating: {
			label: "Rating",
			type: "number" as const,
			validation: { required: true as const },
		},
	},
});

export const createTitlePagesPropertiesSchema = () => ({
	fields: {
		title: { label: "Title", type: "string" as const },
		pages: { label: "Pages", type: "integer" as const },
	},
});

export const createNoteProgressPropertiesSchema = () => ({
	fields: {
		note: { label: "Note", type: "string" as const },
		progress: { label: "Progress", type: "integer" as const },
	},
});

export const createProgressPercentPropertiesSchema = () => ({
	fields: {
		progressPercent: {
			type: "number" as const,
			label: "Progress Percent",
			transform: { round: { mode: "half_up" as const, scale: 2 } },
			validation: {
				maximum: 100,
				exclusiveMinimum: 0,
				required: true as const,
			},
		},
	},
});

export const createShowProgressPropertiesSchema = () => ({
	fields: {
		showSeason: { label: "Show Season", type: "integer" as const },
		showEpisode: { label: "Show Episode", type: "integer" as const },
		progressPercent:
			createProgressPercentPropertiesSchema().fields.progressPercent,
	},
	rules: [
		{
			path: ["showSeason"],
			kind: "validation" as const,
			validation: { required: true as const },
			when: { operator: "exists" as const, path: ["showEpisode"] },
		},
		{
			path: ["showEpisode"],
			kind: "validation" as const,
			validation: { required: true as const },
			when: { operator: "exists" as const, path: ["showSeason"] },
		},
	],
});

export const createAnimeProgressPropertiesSchema = () => ({
	fields: {
		animeEpisode: { label: "Anime Episode", type: "integer" as const },
		progressPercent:
			createProgressPercentPropertiesSchema().fields.progressPercent,
	},
});

export const createMangaProgressPropertiesSchema = () => ({
	fields: {
		mangaVolume: { label: "Manga Volume", type: "integer" as const },
		mangaChapter: { label: "Manga Chapter", type: "number" as const },
		progressPercent:
			createProgressPercentPropertiesSchema().fields.progressPercent,
	},
});

export const createPodcastProgressPropertiesSchema = () => ({
	fields: {
		podcastEpisode: { label: "Podcast Episode", type: "integer" as const },
		progressPercent:
			createProgressPercentPropertiesSchema().fields.progressPercent,
	},
});

export const createCompletePropertiesSchema = () => ({
	fields: {
		startedOn: { label: "Started On", type: "datetime" as const },
		completedOn: { label: "Completed On", type: "datetime" as const },
		completionMode: {
			type: "string" as const,
			label: "Completion Mode",
			validation: {
				required: true as const,
				pattern: "^(just_now|unknown|custom_timestamps)$",
			},
		},
	},
	rules: [
		{
			path: ["completedOn"],
			kind: "validation" as const,
			validation: { required: true as const },
			when: {
				operator: "eq" as const,
				path: ["completionMode"],
				value: "custom_timestamps",
			},
		},
	],
});

export const createReviewPropertiesSchema = () => ({
	fields: {
		review: { label: "Review", type: "string" as const },
		rating: {
			label: "Rating",
			type: "integer" as const,
			validation: { required: true as const, maximum: 5, minimum: 1 },
		},
	},
});

export const createNestedMetadataPropertiesSchema = () => ({
	fields: {
		metadata: {
			label: "Metadata",
			type: "object" as const,
			properties: {
				year: { label: "Year", type: "integer" as const },
				author: { label: "Author", type: "string" as const },
			},
		},
	},
});

export const createNestedPeoplePropertySchema = () => ({
	fields: {
		people: {
			label: "People",
			type: "array" as const,
			items: {
				label: "Item",
				type: "object" as const,
				properties: {
					role: { label: "Role", type: "string" as const },
					externalId: { label: "External ID", type: "string" as const },
				},
			},
		},
	},
});

export const createNestedMatrixPropertySchema = () => ({
	fields: {
		matrix: {
			label: "Matrix",
			type: "array" as const,
			items: {
				label: "Item",
				type: "array" as const,
				items: { label: "Item", type: "number" as const },
			},
		},
	},
});
