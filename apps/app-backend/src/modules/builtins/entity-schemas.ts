import type { AppSchema } from "@ryot/ts-utils/app-schema";
import { match } from "ts-pattern";

import { exercisePropertiesJsonSchema } from "~/lib/fitness/exercise";
import { measurementPropertiesJsonSchema } from "~/lib/fitness/measurement";
import { workoutPropertiesJsonSchema, workoutSetPropertiesJsonSchema } from "~/lib/fitness/workout";
import { workoutTemplatePropertiesJsonSchema } from "~/lib/fitness/workout-template";
import { animePropertiesJsonSchema } from "~/lib/media/anime";
import { audiobookPropertiesJsonSchema } from "~/lib/media/audiobook";
import { bookPropertiesJsonSchema } from "~/lib/media/book";
import { comicBookPropertiesJsonSchema } from "~/lib/media/comic-book";
import { companyPropertiesJsonSchema } from "~/lib/media/company";
import { mangaPropertiesJsonSchema } from "~/lib/media/manga";
import { mediaGroupPropertiesJsonSchema } from "~/lib/media/media-group";
import { moviePropertiesJsonSchema } from "~/lib/media/movie";
import { musicPropertiesJsonSchema } from "~/lib/media/music";
import { personPropertiesJsonSchema } from "~/lib/media/person";
import { podcastPropertiesJsonSchema } from "~/lib/media/podcast";
import { showPropertiesJsonSchema } from "~/lib/media/show";
import { videoGamePropertiesJsonSchema } from "~/lib/media/video-game";
import { visualNovelPropertiesJsonSchema } from "~/lib/media/visual-novel";

const progressPercentPropertiesSchema = () => ({
	fields: {
		progressPercent: {
			type: "number" as const,
			label: "Progress Percent",
			transform: { round: { mode: "half_up" as const, scale: 2 } },
			description: "Percentage of the media completed so far (0 to 100)",
			validation: {
				maximum: 100,
				exclusiveMinimum: 0,
				required: true as const,
			},
		},
	},
});

const progressPropertiesSchemaByEntity = (entitySchemaSlug: string | undefined): AppSchema =>
	match(entitySchemaSlug)
		.with("show", () => ({
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
		}))
		.with("anime", () => ({
			fields: {
				...progressPercentPropertiesSchema().fields,
				animeEpisode: {
					label: "Anime Episode",
					type: "integer" as const,
					description: "Episode number of the anime being tracked",
				},
			},
		}))
		.with("manga", () => ({
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
		}))
		.with("podcast", () => ({
			fields: {
				...progressPercentPropertiesSchema().fields,
				podcastEpisode: {
					label: "Podcast Episode",
					type: "integer" as const,
					description: "Episode number of the podcast being tracked",
				},
			},
		}))
		.otherwise(() => progressPercentPropertiesSchema());

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

const reviewPropertiesSchemaByEntity = (entitySchemaSlug: string | undefined): AppSchema =>
	match(entitySchemaSlug)
		.with("show", () => ({
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
		}))
		.with("anime", () => ({
			fields: {
				...reviewBaseFields(),
				animeEpisode: {
					label: "Anime Episode",
					type: "integer" as const,
					description: "Episode number of the anime being reviewed",
				},
			},
		}))
		.with("manga", () => ({
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
		}))
		.with("podcast", () => ({
			fields: {
				...reviewBaseFields(),
				podcastEpisode: {
					label: "Podcast Episode",
					type: "integer" as const,
					description: "Episode number of the podcast being reviewed",
				},
			},
		}))
		.otherwise(() => ({ fields: reviewBaseFields() }));

const mediaLifecycleEventSchemas = (entitySchemaSlug?: string) => [
	{ name: "Backlog", slug: "backlog", propertiesSchema: { fields: {} } },
	{
		name: "Complete",
		slug: "complete",
		propertiesSchema: {
			fields: {
				startedOn: {
					label: "Started On",
					type: "datetime" as const,
					description: "Date and time you started consuming this media",
				},
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
			rules: [
				{
					path: ["completedOn"],
					kind: "validation" as const,
					validation: { required: true as const },
					when: { operator: "eq" as const, path: ["completionMode"], value: "custom_timestamps" },
				},
			],
		},
	},
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
		propertiesSchema: progressPropertiesSchemaByEntity(entitySchemaSlug),
	},
	{
		name: "On Hold",
		slug: "on_hold",
		propertiesSchema: progressPropertiesSchemaByEntity(entitySchemaSlug),
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
	propertiesSchema: mediaGroupPropertiesJsonSchema,
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
		propertiesSchema: personPropertiesJsonSchema,
		eventSchemas: mediaLifecycleEventSchemas("person").filter((schema) => schema.slug === "review"),
	},
	{
		slug: "company",
		name: "Company",
		icon: "building-2",
		trackerSlug: "media",
		accentColor: "#6B7280",
		propertiesSchema: companyPropertiesJsonSchema,
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
		propertiesSchema: bookPropertiesJsonSchema,
		eventSchemas: mediaLifecycleEventSchemas("book"),
	},
	{
		icon: "book-image",
		slug: "comic-book",
		name: "Comic Book",
		trackerSlug: "media",
		accentColor: "#FF6B35",
		propertiesSchema: comicBookPropertiesJsonSchema,
		eventSchemas: mediaLifecycleEventSchemas("comic-book"),
	},
	{
		icon: "tv",
		slug: "anime",
		name: "Anime",
		trackerSlug: "media",
		accentColor: "#FB7185",
		propertiesSchema: animePropertiesJsonSchema,
		eventSchemas: mediaLifecycleEventSchemas("anime"),
	},
	{
		slug: "movie",
		name: "Movie",
		icon: "clapperboard",
		trackerSlug: "media",
		accentColor: "#FACC15",
		propertiesSchema: moviePropertiesJsonSchema,
		eventSchemas: mediaLifecycleEventSchemas("movie"),
	},
	{
		slug: "show",
		name: "Show",
		icon: "monitor-play",
		trackerSlug: "media",
		accentColor: "#8B5CF6",
		propertiesSchema: showPropertiesJsonSchema,
		eventSchemas: mediaLifecycleEventSchemas("show"),
	},
	{
		slug: "manga",
		name: "Manga",
		icon: "book",
		trackerSlug: "media",
		accentColor: "#D946EF",
		propertiesSchema: mangaPropertiesJsonSchema,
		eventSchemas: mediaLifecycleEventSchemas("manga"),
	},
	{
		slug: "audiobook",
		name: "Audiobook",
		icon: "headphones",
		trackerSlug: "media",
		accentColor: "#F97316",
		propertiesSchema: audiobookPropertiesJsonSchema,
		eventSchemas: mediaLifecycleEventSchemas("audiobook"),
	},
	{
		slug: "podcast",
		name: "Podcast",
		icon: "podcast",
		trackerSlug: "media",
		accentColor: "#06B6D4",
		propertiesSchema: podcastPropertiesJsonSchema,
		eventSchemas: mediaLifecycleEventSchemas("podcast"),
	},
	{
		icon: "gamepad-2",
		slug: "video-game",
		name: "Video Game",
		trackerSlug: "media",
		accentColor: "#10B981",
		propertiesSchema: videoGamePropertiesJsonSchema,
		eventSchemas: mediaLifecycleEventSchemas("video-game"),
	},
	{
		slug: "music",
		name: "Music",
		icon: "music",
		trackerSlug: "media",
		accentColor: "#EC4899",
		propertiesSchema: musicPropertiesJsonSchema,
		eventSchemas: mediaLifecycleEventSchemas("music"),
	},
	{
		icon: "book-heart",
		slug: "visual-novel",
		name: "Visual Novel",
		trackerSlug: "media",
		accentColor: "#F472B6",
		propertiesSchema: visualNovelPropertiesJsonSchema,
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
		propertiesSchema: exercisePropertiesJsonSchema,
		eventSchemas: [
			{
				name: "Workout Set",
				slug: "workout-set",
				propertiesSchema: workoutSetPropertiesJsonSchema,
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
		propertiesSchema: workoutPropertiesJsonSchema,
	},
	{
		eventSchemas: [],
		icon: "clipboard-list",
		trackerSlug: "fitness",
		accentColor: "#A3E635",
		slug: "workout-template",
		name: "Workout Template",
		propertiesSchema: workoutTemplatePropertiesJsonSchema,
	},
	{
		icon: "ruler",
		eventSchemas: [],
		slug: "measurement",
		name: "Measurement",
		trackerSlug: "fitness",
		accentColor: "#6366F1",
		propertiesSchema: measurementPropertiesJsonSchema,
	},
];
