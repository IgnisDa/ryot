import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { reviewPropertyFields } from "@ryot-app/plugin-kit/schema";

import { consumedItemField, withConsumptionFacts } from "./consumption";
import {
	animePropertiesSchema,
	audiobookPropertiesSchema,
	bookPropertiesSchema,
	comicBookPropertiesSchema,
	companyPropertiesSchema,
	mangaPropertiesSchema,
	mediaGroupPropertiesSchema,
	moviePropertiesSchema,
	musicPropertiesSchema,
	personPropertiesSchema,
	podcastEpisodePropertiesSchema,
	podcastPropertiesSchema,
	showEpisodePropertiesSchema,
	showPropertiesSchema,
	showSeasonPropertiesSchema,
	videoGamePropertiesSchema,
	visualNovelPropertiesSchema,
} from "./property";

const consumedOnField = {
	consumedOn: {
		label: "Consumed on",
		type: "string" as const,
		description: "The source or platform where this content was consumed (e.g. Netflix, Jellyfin)",
	},
};

const startedOnField = {
	label: "Started on",
	type: "datetime" as const,
	description: "Date and time you started consuming this media",
};

const timeSpentField = {
	label: "Time spent",
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
			label: "Progress percent",
			validation: { maximum: 100, exclusiveMinimum: 0 },
			description: "Percentage of the media completed so far (0 to 100)",
		},
	},
});

const progressPropertiesSchemaByEntity = (entitySchemaSlug: string | undefined): AppSchema => {
	if (entitySchemaSlug === undefined) {
		return progressPercentPropertiesSchema();
	}
	switch (entitySchemaSlug) {
		case "book":
		case "comic-book":
			return {
				fields: {
					...progressPercentPropertiesSchema().fields,
					progressPages: {
						type: "number",
						label: "Pages reached",
						validation: { minimum: 0 },
						description: "Exact cumulative pages in this run",
					},
				},
			};
		case "anime":
			return {
				fields: {
					...progressPercentPropertiesSchema().fields,
					animeEpisode: {
						label: "Anime episode",
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
						label: "Manga volume",
						type: "integer" as const,
						description: "Volume number of the manga being tracked",
					},
					mangaChapter: {
						label: "Manga chapter",
						type: "number" as const,
						description: "Chapter number of the manga being tracked",
					},
				},
			};
		default:
			return progressPercentPropertiesSchema();
	}
};

const statusPropertiesSchemaByEntity = (entitySchemaSlug: string | undefined): AppSchema =>
	entitySchemaSlug === "show" || entitySchemaSlug === "podcast"
		? { fields: { ...consumedOnField } }
		: progressPropertiesSchemaByEntity(entitySchemaSlug);

const listStateDateComponent = (label: string, maximum?: number) => ({
	label,
	type: "integer" as const,
	description: `${label} in the AniList date`,
	validation: { minimum: 1, ...(maximum === undefined ? {} : { maximum }) },
});

const listStateDateField = (label: string, description: string, position: number) => ({
	label,
	position,
	description,
	type: "object" as const,
	unknownKeys: "strict" as const,
	properties: {
		year: listStateDateComponent("Year"),
		day: listStateDateComponent("Day", 31),
		month: listStateDateComponent("Month", 12),
	},
});

const listStateEventSchema = (entitySchemaSlug: "anime" | "manga") => ({
	name: "List State",
	slug: "list-state",
	propertiesSchema: {
		unknownKeys: "strict" as const,
		fields: {
			startedDate: listStateDateField(
				"Started Date",
				"The partial start date AniList reports, without inferred components",
				6,
			),
			completedDate: listStateDateField(
				"Completed Date",
				"The partial completion date AniList reports, without inferred components",
				7,
			),
			repeatCount: {
				position: 5,
				label: "Repeat count",
				type: "integer" as const,
				validation: { minimum: 0, required: true as const },
				description: "The number of repeats recorded by AniList",
			},
			sourceEntryId: {
				position: 2,
				type: "string" as const,
				label: "Source entry ID",
				validation: { minLength: 1, required: true as const },
				description: "The AniList list entry that provided this state",
			},
			sourceUpdatedAt: {
				position: 4,
				type: "datetime" as const,
				label: "Source updated at",
				validation: { required: true as const },
				description: "The last update time AniList reports for this list entry",
			},
			sourceAccountId: {
				position: 1,
				type: "string" as const,
				label: "Source account ID",
				validation: { minLength: 1, required: true as const },
				description: "The AniList account that provided this list state",
			},
			source: {
				position: 0,
				label: "Source",
				type: "enum" as const,
				validation: { required: true as const },
				description: "The source that provided this list state",
				choices: { kind: "static" as const, values: [{ value: "anilist", label: "AniList" }] },
			},
			state: {
				position: 3,
				label: "List state",
				type: "enum" as const,
				validation: { required: true as const },
				description: "The current state recorded by AniList",
				choices: {
					kind: "static" as const,
					values: [
						{ value: "backlog" },
						{ value: "in_progress" },
						{ value: "on_hold" },
						{ value: "dropped" },
						{ value: "complete" },
					],
				},
			},
			...(entitySchemaSlug === "anime"
				? {
						animeEpisode: {
							position: 8,
							label: "Anime episode",
							type: "integer" as const,
							validation: { minimum: 0 },
							description: "Episode number AniList reports for this anime",
						},
					}
				: {
						mangaVolume: {
							position: 8,
							label: "Manga volume",
							type: "integer" as const,
							validation: { minimum: 0 },
							description: "Volume number AniList reports for this manga",
						},
						mangaChapter: {
							position: 9,
							label: "Manga chapter",
							type: "number" as const,
							validation: { minimum: 0 },
							description: "Chapter number AniList reports for this manga",
						},
					}),
		},
	},
});

const lifecycleEventSchemaBySlug = (slug: string) => {
	const eventSchema = mediaLifecycleEventSchemas().find((schema) => schema.slug === slug);
	if (!eventSchema) {
		throw new Error(`Missing builtin lifecycle event schema: ${slug}`);
	}
	return eventSchema;
};

const libraryEventSchema = () => ({
	slug: "add-to-media-library",
	name: "Added to media library",
	propertiesSchema: { fields: {} },
});

const reviewPropertiesSchemaByEntity = (entitySchemaSlug: string | undefined): AppSchema => {
	const fields = reviewPropertyFields("Your written thoughts or notes about this media");
	switch (entitySchemaSlug) {
		case "anime":
			return {
				fields: {
					...fields,
					animeEpisode: {
						label: "Anime episode",
						type: "integer" as const,
						description: "Episode number of the anime being reviewed",
					},
				},
			};
		case "manga":
			return {
				fields: {
					...fields,
					mangaVolume: {
						label: "Manga volume",
						type: "integer" as const,
						description: "Volume number of the manga being reviewed",
					},
					mangaChapter: {
						label: "Manga chapter",
						type: "number" as const,
						description: "Chapter number of the manga being reviewed",
					},
				},
			};
		case undefined:
		default:
			return { fields };
	}
};

const mediaLifecycleEventSchemas = (entitySchemaSlug?: string) => [
	libraryEventSchema(),
	{ name: "Backlog", slug: "backlog", propertiesSchema: { fields: {} } },
	{
		name: "Progress",
		slug: "progress",
		propertiesSchema: withConsumptionFacts(
			withStartedOn(withTimeSpent(progressPropertiesSchemaByEntity(entitySchemaSlug))),
		),
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
			withTimeSpent(withConsumptionFacts(statusPropertiesSchemaByEntity(entitySchemaSlug))),
		),
	},
	{
		name: "On Hold",
		slug: "on_hold",
		propertiesSchema: withStartedOn(
			withTimeSpent(withConsumptionFacts(statusPropertiesSchemaByEntity(entitySchemaSlug))),
		),
	},
	{
		name: "Complete",
		slug: "complete",
		propertiesSchema: withConsumptionFacts({
			fields: {
				...consumedOnField,
				timeSpent: timeSpentField,
				startedOn: startedOnField,
				completionKey: {
					type: "string" as const,
					label: "Automatic completion identity",
					description: "Key of the completion occurrence that derived this record",
				},
				completionSilent: {
					type: "boolean" as const,
					label: "Silent history correction",
					description: "Whether creating this derived record must skip external delivery",
				},
				dateUnknown: {
					label: "Date unknown",
					type: "boolean" as const,
					description:
						"Whether the completion date is unknown; occurredAt is the real completion time otherwise",
				},
			},
		}),
	},
	...(entitySchemaSlug === "anime" || entitySchemaSlug === "manga"
		? [
				listStateEventSchema(entitySchemaSlug),
				{
					name: "Item consumed",
					slug: "item-complete",
					propertiesSchema: withConsumptionFacts({
						fields: {
							...consumedOnField,
							timeSpent: timeSpentField,
							startedOn: startedOnField,
							consumedItem: consumedItemField(entitySchemaSlug),
						},
					}),
				},
			]
		: []),
];

const buildMediaGroupEntitySchema = (slug: string, name: string, icon: string) => ({
	slug,
	name,
	icon,
	propertiesSchema: mediaGroupPropertiesSchema,
	eventSchemas: mediaLifecycleEventSchemas(slug).filter(
		(s) => s.slug === "review" || s.slug === "add-to-media-library",
	),
});

export const mediaEntitySchemas = () => [
	{
		icon: "library",
		eventSchemas: [],
		slug: "media-library",
		name: "Media Library",
		propertiesSchema: { fields: {} },
		userState: { deniedOperations: ["clear", "merge"] as const },
	},
	{
		icon: "user",
		slug: "person",
		name: "Person",
		refreshIntervalDays: 365,
		propertiesSchema: personPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("person").filter(
			(schema) => schema.slug === "review" || schema.slug === "add-to-media-library",
		),
	},
	{
		icon: "tags",
		slug: "genre",
		name: "Genre",
		eventSchemas: [],
		propertiesSchema: { fields: {} },
	},
	{
		slug: "company",
		name: "Company",
		icon: "building-2",
		refreshIntervalDays: 365,
		propertiesSchema: companyPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("company").filter(
			(schema) => schema.slug === "review" || schema.slug === "add-to-media-library",
		),
	},
	buildMediaGroupEntitySchema("movie-group", "Movie Collection", "film"),
	buildMediaGroupEntitySchema("audiobook-group", "Audiobook Series", "mic"),
	buildMediaGroupEntitySchema("book-group", "Book Series", "book-copy"),
	buildMediaGroupEntitySchema("comic-book-group", "Comic Book Series", "sparkles"),
	buildMediaGroupEntitySchema("music-group", "Music Album", "disc-3"),
	buildMediaGroupEntitySchema("video-game-group", "Video Game Collection", "joystick"),
	{
		slug: "book",
		name: "Book",
		icon: "book-open",
		refreshIntervalDays: 365,
		occursAtProperty: "publishDate",
		propertiesSchema: bookPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("book"),
	},
	{
		icon: "book-image",
		slug: "comic-book",
		name: "Comic Book",
		refreshIntervalDays: 365,
		occursAtProperty: "publishDate",
		propertiesSchema: comicBookPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("comic-book"),
	},
	{
		icon: "tv",
		slug: "anime",
		name: "Anime",
		refreshIntervalDays: 30,
		occursAtProperty: "publishDate",
		propertiesSchema: animePropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("anime"),
	},
	{
		slug: "movie",
		name: "Movie",
		icon: "clapperboard",
		refreshIntervalDays: 180,
		occursAtProperty: "publishDate",
		propertiesSchema: moviePropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("movie"),
	},
	{
		slug: "show",
		name: "Show",
		icon: "monitor-play",
		refreshIntervalDays: 7,
		propertiesSchema: showPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("show").filter((schema) => schema.slug !== "progress"),
	},
	{
		icon: "list-video",
		slug: "show-season",
		name: "Show Season",
		propertiesSchema: showSeasonPropertiesSchema,
		eventSchemas: [
			lifecycleEventSchemaBySlug("review"),
			lifecycleEventSchemaBySlug("add-to-media-library"),
		],
	},
	{
		icon: "play-square",
		slug: "show-episode",
		name: "Show Episode",
		occursAtProperty: "publishDate",
		propertiesSchema: showEpisodePropertiesSchema,
		eventSchemas: [
			lifecycleEventSchemaBySlug("progress"),
			lifecycleEventSchemaBySlug("review"),
			lifecycleEventSchemaBySlug("complete"),
			lifecycleEventSchemaBySlug("add-to-media-library"),
		],
	},
	{
		icon: "book",
		slug: "manga",
		name: "Manga",
		refreshIntervalDays: 30,
		occursAtProperty: "publishDate",
		propertiesSchema: mangaPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("manga"),
	},
	{
		slug: "audiobook",
		name: "Audiobook",
		icon: "headphones",
		refreshIntervalDays: 365,
		occursAtProperty: "publishDate",
		propertiesSchema: audiobookPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("audiobook"),
	},
	{
		slug: "podcast",
		name: "Podcast",
		icon: "podcast",
		refreshIntervalDays: 30,
		propertiesSchema: podcastPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("podcast").filter(
			(schema) => schema.slug !== "progress",
		),
	},
	{
		icon: "radio",
		slug: "podcast-episode",
		name: "Podcast Episode",
		occursAtProperty: "publishDate",
		propertiesSchema: podcastEpisodePropertiesSchema,
		eventSchemas: [
			lifecycleEventSchemaBySlug("progress"),
			lifecycleEventSchemaBySlug("review"),
			lifecycleEventSchemaBySlug("complete"),
			lifecycleEventSchemaBySlug("add-to-media-library"),
		],
	},
	{
		icon: "gamepad-2",
		slug: "video-game",
		name: "Video Game",
		refreshIntervalDays: 180,
		occursAtProperty: "publishDate",
		propertiesSchema: videoGamePropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("video-game"),
	},
	{
		slug: "music",
		name: "Music",
		icon: "music",
		refreshIntervalDays: 180,
		occursAtProperty: "publishDate",
		propertiesSchema: musicPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("music"),
	},
	{
		icon: "book-heart",
		slug: "visual-novel",
		name: "Visual Novel",
		refreshIntervalDays: 180,
		occursAtProperty: "publishDate",
		propertiesSchema: visualNovelPropertiesSchema,
		eventSchemas: mediaLifecycleEventSchemas("visual-novel"),
	},
];
