import type { AppSchema } from "~/lib/schema";

import {
	exercisePropertiesSchema,
	measurementPropertiesSchema,
	workoutPropertiesSchema,
	workoutTemplatePropertiesSchema,
	workoutSetPropertiesSchema,
} from "./fitness-property-schemas";
import {
	audiobookPropertiesSchema,
	bookPropertiesSchema,
	comicBookPropertiesSchema,
	companyPropertiesSchema,
	mediaGroupPropertiesSchema,
	mangaPropertiesSchema,
	moviePropertiesSchema,
	musicPropertiesSchema,
	personPropertiesSchema,
	podcastPropertiesSchema,
	showPropertiesSchema,
	visualNovelPropertiesSchema,
	animePropertiesSchema,
	videoGamePropertiesSchema,
} from "./media-property-schemas";

const consumedOnField = {
	consumedOn: {
		label: "Consumed On",
		type: "string" as const,
		description: "The source or platform where this content was consumed (e.g. Netflix, Jellyfin)",
	},
};

const startedOnField = {
	label: "Started On",
	type: "datetime" as const,
	description: "Date and time you started consuming this media",
};

const timeSpentField = {
	label: "Time Spent",
	type: "number" as const,
	validation: { minimum: 0 },
	description: "Time spent consuming this media in minutes",
};

const withStartedOn = (schema: AppSchema): AppSchema => ({
	...schema,
	fields: { startedOn: startedOnField, ...schema.fields },
});

const withTimeSpent = (schema: AppSchema): AppSchema => ({
	...schema,
	fields: { ...schema.fields, timeSpent: timeSpentField },
});

const progressPercentPropertiesSchema = (): AppSchema => ({
	fields: {
		...consumedOnField,
		progressPercent: {
			type: "number" as const,
			label: "Progress Percent",
			transform: { round: { mode: "half_up" as const, scale: 2 } },
			description: "Percentage of the media completed so far (0 to 100)",
			validation: { maximum: 100, exclusiveMinimum: 0, required: true as const },
		},
	},
});

const progressPropertiesSchemaByEntity = (entitySchemaSlug: string | undefined): AppSchema => {
	if (entitySchemaSlug === undefined) {
		return progressPercentPropertiesSchema();
	}
	switch (entitySchemaSlug) {
		case "show":
			return {
				fields: {
					...progressPercentPropertiesSchema().fields,
					showSeason: {
						label: "Show Season",
						type: "integer" as const,
						description: "Season number being tracked",
					},
					showEpisode: {
						label: "Show Episode",
						type: "integer" as const,
						description: "Episode number within the current season",
					},
				},
			};
		case "anime":
			return {
				fields: {
					...progressPercentPropertiesSchema().fields,
					animeEpisode: {
						label: "Anime Episode",
						type: "integer" as const,
						description: "Episode number of the anime being tracked",
					},
				},
			};
		case "manga":
			return {
				fields: {
					...progressPercentPropertiesSchema().fields,
					mangaVolume: {
						label: "Manga Volume",
						type: "integer" as const,
						description: "Volume number of the manga being tracked",
					},
					mangaChapter: {
						label: "Manga Chapter",
						type: "number" as const,
						description: "Chapter number of the manga being tracked",
					},
				},
			};
		case "podcast":
			return {
				fields: {
					...progressPercentPropertiesSchema().fields,
					podcastEpisode: {
						label: "Podcast Episode",
						type: "integer" as const,
						description: "Episode number of the podcast being tracked",
					},
				},
			};
		default:
			return progressPercentPropertiesSchema();
	}
};

const reviewBaseFields = () => ({
	text: {
		label: "Review",
		type: "string" as const,
		description: "Your written thoughts or notes about this media",
	},
	isSpoiler: {
		label: "Is Spoiler?",
		type: "boolean" as const,
		description: "Whether this review contains spoilers",
	},
	rating: {
		label: "Rating",
		type: "number" as const,
		validation: { maximum: 100, minimum: 0 },
		description: "Your personal rating from 0 (lowest) to 100 (highest)",
	},
});

const reviewPropertiesSchemaByEntity = (entitySchemaSlug: string | undefined): AppSchema => {
	if (entitySchemaSlug === undefined) {
		return { fields: reviewBaseFields() };
	}
	switch (entitySchemaSlug) {
		case "show":
			return {
				fields: {
					...reviewBaseFields(),
					showSeason: {
						label: "Show Season",
						type: "integer" as const,
						description: "Season number of the episode being reviewed",
					},
					showEpisode: {
						label: "Show Episode",
						type: "integer" as const,
						description: "Episode number within the current season being reviewed",
					},
				},
			};
		case "anime":
			return {
				fields: {
					...reviewBaseFields(),
					animeEpisode: {
						label: "Anime Episode",
						type: "integer" as const,
						description: "Episode number of the anime being reviewed",
					},
				},
			};
		case "manga":
			return {
				fields: {
					...reviewBaseFields(),
					mangaVolume: {
						label: "Manga Volume",
						type: "integer" as const,
						description: "Volume number of the manga being reviewed",
					},
					mangaChapter: {
						label: "Manga Chapter",
						type: "number" as const,
						description: "Chapter number of the manga being reviewed",
					},
				},
			};
		case "podcast":
			return {
				fields: {
					...reviewBaseFields(),
					podcastEpisode: {
						label: "Podcast Episode",
						type: "integer" as const,
						description: "Episode number of the podcast being reviewed",
					},
				},
			};
		default:
			return { fields: reviewBaseFields() };
	}
};

export const mediaLifecycleEventSchemas = (entitySchemaSlug?: string) => [
	{ name: "Backlog", slug: "backlog", propertiesSchema: { fields: {} } },
	{
		name: "Progress",
		slug: "progress",
		propertiesSchema: progressPropertiesSchemaByEntity(entitySchemaSlug),
	},
	{
		name: "Review",
		slug: "review",
		propertiesSchema: reviewPropertiesSchemaByEntity(entitySchemaSlug),
	},
	{
		name: "Dropped",
		slug: "dropped",
		propertiesSchema: withStartedOn(
			withTimeSpent(progressPropertiesSchemaByEntity(entitySchemaSlug)),
		),
	},
	{
		name: "On Hold",
		slug: "on_hold",
		propertiesSchema: withStartedOn(
			withTimeSpent(progressPropertiesSchemaByEntity(entitySchemaSlug)),
		),
	},
	{
		name: "Complete",
		slug: "complete",
		propertiesSchema: {
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
			fields: {
				...consumedOnField,
				timeSpent: timeSpentField,
				startedOn: startedOnField,
				completedOn: {
					label: "Completed On",
					type: "datetime" as const,
					description: "Date and time you finished consuming this media",
				},
				completionMode: {
					type: "string" as const,
					label: "Completion Mode",
					description:
						"How the completion timestamps were determined: just_now, unknown, or custom_timestamps",
					validation: {
						required: true as const,
						pattern: "^(just_now|unknown|custom_timestamps)$",
					},
				},
			},
		},
	},
];

const buildMediaGroupEntitySchema = (
	slug: string,
	name: string,
	accentColor: string,
	icon: string,
) => ({
	slug,
	name,
	icon,
	accentColor,
	trackerSlug: "media",
	propertiesSchema: mediaGroupPropertiesSchema,
	eventSchemas: mediaLifecycleEventSchemas(slug).filter((s) => s.slug === "review"),
});

export const builtinEntitySchemas = () => [
	{
		slug: "library",
		name: "Library",
		icon: "library",
		eventSchemas: [],
		trackerSlug: undefined,
		accentColor: "#9CA3AF",
		propertiesSchema: { fields: {} },
	},
	{
		icon: "user",
		slug: "person",
		name: "Person",
		trackerSlug: "media",
		accentColor: "#4B5563",
		propertiesSchema: personPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("person").filter((schema) => schema.slug === "review"),
	},
	{
		slug: "company",
		name: "Company",
		icon: "building-2",
		trackerSlug: "media",
		accentColor: "#6B7280",
		propertiesSchema: companyPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("company").filter(
			(schema) => schema.slug === "review",
		),
	},
	buildMediaGroupEntitySchema("movie-group", "Movie Collection", "#FACC15", "film"),
	buildMediaGroupEntitySchema("audiobook-group", "Audiobook Series", "#F97316", "mic"),
	buildMediaGroupEntitySchema("book-group", "Book Series", "#3B82F6", "book-copy"),
	buildMediaGroupEntitySchema("comic-book-group", "Comic Book Series", "#FF6B35", "sparkles"),
	buildMediaGroupEntitySchema("music-group", "Music Album", "#EC4899", "disc-3"),
	buildMediaGroupEntitySchema("video-game-group", "Video Game Collection", "#10B981", "joystick"),
	{
		slug: "book",
		name: "Book",
		icon: "book-open",
		trackerSlug: "media",
		accentColor: "#3B82F6",
		propertiesSchema: bookPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("book"),
	},
	{
		icon: "book-image",
		slug: "comic-book",
		name: "Comic Book",
		trackerSlug: "media",
		accentColor: "#FF6B35",
		propertiesSchema: comicBookPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("comic-book"),
	},
	{
		icon: "tv",
		slug: "anime",
		name: "Anime",
		trackerSlug: "media",
		accentColor: "#FB7185",
		propertiesSchema: animePropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("anime"),
	},
	{
		slug: "movie",
		name: "Movie",
		icon: "clapperboard",
		trackerSlug: "media",
		accentColor: "#FACC15",
		propertiesSchema: moviePropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("movie"),
	},
	{
		slug: "show",
		name: "Show",
		icon: "monitor-play",
		trackerSlug: "media",
		accentColor: "#8B5CF6",
		propertiesSchema: showPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("show"),
	},
	{
		slug: "manga",
		name: "Manga",
		icon: "book",
		trackerSlug: "media",
		accentColor: "#D946EF",
		propertiesSchema: mangaPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("manga"),
	},
	{
		slug: "audiobook",
		name: "Audiobook",
		icon: "headphones",
		trackerSlug: "media",
		accentColor: "#F97316",
		propertiesSchema: audiobookPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("audiobook"),
	},
	{
		slug: "podcast",
		name: "Podcast",
		icon: "podcast",
		trackerSlug: "media",
		accentColor: "#06B6D4",
		propertiesSchema: podcastPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("podcast"),
	},
	{
		icon: "gamepad-2",
		slug: "video-game",
		name: "Video Game",
		trackerSlug: "media",
		accentColor: "#10B981",
		propertiesSchema: videoGamePropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("video-game"),
	},
	{
		slug: "music",
		name: "Music",
		icon: "music",
		trackerSlug: "media",
		accentColor: "#EC4899",
		propertiesSchema: musicPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("music"),
	},
	{
		icon: "book-heart",
		slug: "visual-novel",
		name: "Visual Novel",
		trackerSlug: "media",
		accentColor: "#F472B6",
		propertiesSchema: visualNovelPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("visual-novel"),
	},
	{
		icon: "folders",
		slug: "collection",
		name: "Collection",
		trackerSlug: "media",
		accentColor: "#F59E0B",
		eventSchemas: [
			{
				name: "Review",
				slug: "review",
				propertiesSchema: reviewPropertiesSchemaByEntity("collection"),
			},
			{
				name: "Add Entity to Collection",
				slug: "add-entity-to-collection",
				propertiesSchema: {
					fields: {
						entityId: {
							label: "Entity ID",
							type: "string" as const,
							validation: { required: true as const },
							description: "ID of the entity added to the collection",
						},
						entitySchemaSlug: {
							type: "string" as const,
							label: "Entity Schema Slug",
							validation: { required: true as const },
							description: "Schema slug of the entity added to the collection",
						},
						relationshipId: {
							type: "string" as const,
							label: "Relationship ID",
							validation: { required: true as const },
							description: "ID of the membership relationship",
						},
						relationshipProperties: {
							properties: {},
							type: "object" as const,
							label: "Relationship Properties",
							unknownKeys: "passthrough" as const,
							description: "Properties of the membership relationship",
						},
					},
				},
			},
			{
				name: "Remove Entity from Collection",
				slug: "remove-entity-from-collection",
				propertiesSchema: {
					fields: {
						entityId: {
							label: "Entity ID",
							type: "string" as const,
							validation: { required: true as const },
							description: "ID of the entity removed from the collection",
						},
						entitySchemaSlug: {
							type: "string" as const,
							label: "Entity Schema Slug",
							validation: { required: true as const },
							description: "Schema slug of the entity removed from the collection",
						},
						relationshipId: {
							type: "string" as const,
							label: "Relationship ID",
							validation: { required: true as const },
							description: "ID of the membership relationship that was deleted",
						},
						relationshipProperties: {
							properties: {},
							type: "object" as const,
							label: "Relationship Properties",
							unknownKeys: "passthrough" as const,
							description: "Properties of the deleted membership relationship",
						},
					},
				},
			},
		],
		propertiesSchema: {
			fields: {
				description: {
					label: "Description",
					type: "string" as const,
					description: "A short summary or description of this collection",
				},
				membershipPropertiesSchema: {
					properties: {},
					type: "object" as const,
					unknownKeys: "passthrough" as const,
					label: "Membership Properties Schema",
					description:
						"JSON object schema defining extra properties attached to each collection member",
				},
			},
		},
	},
	{
		icon: "zap",
		slug: "exercise",
		name: "Exercise",
		trackerSlug: "fitness",
		accentColor: "#14B8A6",
		propertiesSchema: exercisePropertiesSchema,
		eventSchemas: [
			{
				name: "Workout Set",
				slug: "workout-set",
				propertiesSchema: workoutSetPropertiesSchema,
			},
			{
				name: "Review",
				slug: "review",
				propertiesSchema: reviewPropertiesSchemaByEntity("exercise"),
			},
		],
	},
	{
		slug: "workout",
		name: "Workout",
		icon: "dumbbell",
		eventSchemas: [],
		trackerSlug: "fitness",
		accentColor: "#84CC16",
		propertiesSchema: workoutPropertiesSchema,
	},
	{
		eventSchemas: [],
		icon: "clipboard-list",
		trackerSlug: "fitness",
		accentColor: "#A3E635",
		slug: "workout-template",
		name: "Workout Template",
		propertiesSchema: workoutTemplatePropertiesSchema,
	},
	{
		icon: "ruler",
		eventSchemas: [],
		slug: "measurement",
		name: "Measurement",
		trackerSlug: "fitness",
		accentColor: "#6366F1",
		propertiesSchema: measurementPropertiesSchema,
	},
];
