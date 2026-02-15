import { workoutSetPropertiesJsonSchema } from "~/lib/fitness/workout";

export const createOptionalTitlePropertiesSchema = () => ({
	fields: {
		title: { label: "Title", description: "Title", type: "string" as const },
	},
});

export const createRequiredTitlePropertiesSchema = () => ({
	fields: {
		title: {
			label: "Title",
			description: "Title",
			type: "string" as const,
			validation: { required: true as const },
		},
	},
});

export const createOptionalRatingPropertiesSchema = () => ({
	fields: {
		rating: { label: "Rating", description: "Rating", type: "number" as const },
	},
});

export const createTitleAndPagesPropertiesSchema = () => ({
	fields: {
		pages: { label: "Pages", description: "Pages", type: "integer" as const },
		title: {
			label: "Title",
			description: "Title",
			type: "string" as const,
			validation: { required: true as const },
		},
	},
});

export const createNoteAndRatingPropertiesSchema = () => ({
	fields: {
		note: { label: "Note", description: "Note", type: "string" as const },
		rating: {
			label: "Rating",
			description: "Rating",
			type: "number" as const,
			validation: { required: true as const },
		},
	},
});

export const createTitlePagesPropertiesSchema = () => ({
	fields: {
		title: { label: "Title", description: "Title", type: "string" as const },
		pages: { label: "Pages", description: "Pages", type: "integer" as const },
	},
});

export const createNoteProgressPropertiesSchema = () => ({
	fields: {
		note: { label: "Note", description: "Note", type: "string" as const },
		progress: {
			label: "Progress",
			description: "Progress",
			type: "integer" as const,
		},
	},
});

export const createProgressPercentPropertiesSchema = () => ({
	fields: {
		progressPercent: {
			type: "number" as const,
			label: "Progress Percent",
			description: "Progress Percent",
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
		progressPercent:
			createProgressPercentPropertiesSchema().fields.progressPercent,
		showSeason: {
			label: "Show Season",
			type: "integer" as const,
			description: "Show Season",
		},
		showEpisode: {
			label: "Show Episode",
			type: "integer" as const,
			description: "Show Episode",
		},
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
		progressPercent:
			createProgressPercentPropertiesSchema().fields.progressPercent,
		animeEpisode: {
			label: "Anime Episode",
			type: "integer" as const,
			description: "Anime Episode",
		},
	},
});

export const createMangaProgressPropertiesSchema = () => ({
	fields: {
		progressPercent:
			createProgressPercentPropertiesSchema().fields.progressPercent,
		mangaVolume: {
			label: "Manga Volume",
			type: "integer" as const,
			description: "Manga Volume",
		},
		mangaChapter: {
			label: "Manga Chapter",
			type: "number" as const,
			description: "Manga Chapter",
		},
	},
});

export const createPodcastProgressPropertiesSchema = () => ({
	fields: {
		progressPercent:
			createProgressPercentPropertiesSchema().fields.progressPercent,
		podcastEpisode: {
			label: "Podcast Episode",
			type: "integer" as const,
			description: "Podcast Episode",
		},
	},
});

export const createCompletePropertiesSchema = () => ({
	fields: {
		startedOn: {
			label: "Started On",
			type: "datetime" as const,
			description: "Started On",
		},
		completedOn: {
			label: "Completed On",
			type: "datetime" as const,
			description: "Completed On",
		},
		completionMode: {
			type: "string" as const,
			label: "Completion Mode",
			description: "Completion Mode",
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
		review: { label: "Review", description: "Review", type: "string" as const },
		rating: {
			label: "Rating",
			description: "Rating",
			type: "integer" as const,
			validation: { required: true as const, maximum: 5, minimum: 1 },
		},
	},
});

export const createWorkoutSetPropertiesSchema = () =>
	workoutSetPropertiesJsonSchema;

export const createNestedMetadataPropertiesSchema = () => ({
	fields: {
		metadata: {
			label: "Metadata",
			description: "Metadata",
			type: "object" as const,
			properties: {
				year: { label: "Year", description: "Year", type: "integer" as const },
				author: {
					label: "Author",
					description: "Author",
					type: "string" as const,
				},
			},
		},
	},
});

export const createNestedPeoplePropertySchema = () => ({
	fields: {
		people: {
			label: "People",
			description: "People",
			type: "array" as const,
			items: {
				label: "Item",
				description: "Item",
				type: "object" as const,
				properties: {
					role: {
						label: "Role",
						description: "Role",
						type: "string" as const,
					},
					externalId: {
						label: "External ID",
						type: "string" as const,
						description: "External ID",
					},
				},
			},
		},
	},
});

export const createNestedMatrixPropertySchema = () => ({
	fields: {
		matrix: {
			label: "Matrix",
			description: "Matrix",
			type: "array" as const,
			items: {
				label: "Item",
				description: "Item",
				type: "array" as const,
				items: {
					label: "Item",
					description: "Item",
					type: "number" as const,
				},
			},
		},
	},
});
