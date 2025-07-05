import type { AppSchema } from "@ryot/ts-utils";
import { normalizeSlug } from "@ryot/ts-utils";
import { match } from "ts-pattern";
import { exercisePropertiesJsonSchema } from "~/lib/fitness/exercise";
import {
	workoutPropertiesJsonSchema,
	workoutSetPropertiesJsonSchema,
} from "~/lib/fitness/workout";
import { animePropertiesJsonSchema } from "~/lib/media/anime";
import { audiobookPropertiesJsonSchema } from "~/lib/media/audiobook";
import { bookPropertiesJsonSchema } from "~/lib/media/book";
import { comicBookPropertiesJsonSchema } from "~/lib/media/comic-book";
import {
	type BuiltinMediaEntitySchemaSlug,
	builtinMediaEntitySchemaSlugs,
} from "~/lib/media/constants";
import { mangaPropertiesJsonSchema } from "~/lib/media/manga";
import { moviePropertiesJsonSchema } from "~/lib/media/movie";
import { musicPropertiesJsonSchema } from "~/lib/media/music";
import { personPropertiesJsonSchema } from "~/lib/media/person";
import { podcastPropertiesJsonSchema } from "~/lib/media/podcast";
import { showPropertiesJsonSchema } from "~/lib/media/show";
import { videoGamePropertiesJsonSchema } from "~/lib/media/video-game";
import { visualNovelPropertiesJsonSchema } from "~/lib/media/visual-novel";
import { createDefaultDisplayConfiguration } from "~/modules/saved-views/constants";

export const authenticationBuiltinTrackers = () => [
	{
		icon: "film",
		slug: "media",
		name: "Media",
		accentColor: "#5B7FFF",
		description:
			"Track media across movies, shows, books, comic books, anime, manga, audiobooks, podcasts, video games, and music.",
	},
	{
		slug: "fitness",
		name: "Fitness",
		icon: "dumbbell",
		accentColor: "#2DD4BF",
		description: "Track workouts, measurements, and progress.",
	},
];

const progressPercentPropertiesSchema = () => ({
	fields: {
		progressPercent: {
			type: "number" as const,
			label: "Progress Percent",
			description: "Percentage of the media completed so far (0–100)",
			transform: { round: { mode: "half_up" as const, scale: 2 } },
			validation: {
				maximum: 100,
				exclusiveMinimum: 0,
				required: true as const,
			},
		},
	},
});

const progressPropertiesSchemaByEntity = (
	entitySchemaSlug: string | undefined,
): AppSchema =>
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
					when: {
						operator: "eq" as const,
						path: ["completionMode"],
						value: "custom_timestamps",
					},
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
		propertiesSchema: {
			fields: {
				review: {
					label: "Review",
					description: "Your written thoughts or notes about this media",
					type: "string" as const,
				},
				rating: {
					label: "Rating",
					description: "Your personal rating from 1 (lowest) to 5 (highest)",
					type: "integer" as const,
					validation: { maximum: 5, minimum: 1, required: true as const },
				},
			},
		},
	},
];

export const authenticationBuiltinEntitySchemas = () => [
	{
		slug: "library",
		name: "Library",
		icon: "library",
		eventSchemas: [],
		accentColor: "#6B7280",
		propertiesSchema: { fields: {} },
	},
	{
		icon: "user",
		slug: "person",
		name: "Person",
		trackerSlug: "media",
		accentColor: "#6B7280",
		propertiesSchema: personPropertiesJsonSchema,
		eventSchemas: mediaLifecycleEventSchemas("person").filter(
			(schema) => schema.slug === "review",
		),
	},
	{
		slug: "book",
		name: "Book",
		icon: "book-open",
		trackerSlug: "media",
		accentColor: "#5B7FFF",
		eventSchemas: mediaLifecycleEventSchemas("book"),
		propertiesSchema: bookPropertiesJsonSchema,
	},
	{
		icon: "book-image",
		slug: "comic-book",
		name: "Comic Book",
		trackerSlug: "media",
		accentColor: "#FF6B35",
		eventSchemas: mediaLifecycleEventSchemas("comic-book"),
		propertiesSchema: comicBookPropertiesJsonSchema,
	},
	{
		icon: "tv",
		slug: "anime",
		name: "Anime",
		eventSchemas: mediaLifecycleEventSchemas("anime"),
		trackerSlug: "media",
		accentColor: "#FB7185",
		propertiesSchema: animePropertiesJsonSchema,
	},
	{
		slug: "movie",
		name: "Movie",
		icon: "clapperboard",
		trackerSlug: "media",
		accentColor: "#FACC15",
		eventSchemas: mediaLifecycleEventSchemas("movie"),
		propertiesSchema: moviePropertiesJsonSchema,
	},
	{
		slug: "show",
		name: "Show",
		icon: "monitor-play",
		trackerSlug: "media",
		accentColor: "#8B5CF6",
		eventSchemas: mediaLifecycleEventSchemas("show"),
		propertiesSchema: showPropertiesJsonSchema,
	},
	{
		slug: "manga",
		name: "Manga",
		icon: "book",
		trackerSlug: "media",
		accentColor: "#A78BFA",
		eventSchemas: mediaLifecycleEventSchemas("manga"),
		propertiesSchema: mangaPropertiesJsonSchema,
	},
	{
		slug: "audiobook",
		name: "Audiobook",
		icon: "headphones",
		trackerSlug: "media",
		accentColor: "#F97316",
		eventSchemas: mediaLifecycleEventSchemas("audiobook"),
		propertiesSchema: audiobookPropertiesJsonSchema,
	},
	{
		slug: "podcast",
		name: "Podcast",
		icon: "podcast",
		trackerSlug: "media",
		accentColor: "#06B6D4",
		eventSchemas: mediaLifecycleEventSchemas("podcast"),
		propertiesSchema: podcastPropertiesJsonSchema,
	},
	{
		icon: "gamepad-2",
		slug: "video-game",
		name: "Video Game",
		trackerSlug: "media",
		accentColor: "#22C55E",
		eventSchemas: mediaLifecycleEventSchemas("video-game"),
		propertiesSchema: videoGamePropertiesJsonSchema,
	},
	{
		slug: "music",
		name: "Music",
		icon: "music",
		trackerSlug: "media",
		accentColor: "#EC4899",
		eventSchemas: mediaLifecycleEventSchemas("music"),
		propertiesSchema: musicPropertiesJsonSchema,
	},
	{
		icon: "book-heart",
		slug: "visual-novel",
		name: "Visual Novel",
		trackerSlug: "media",
		accentColor: "#F472B6",
		eventSchemas: mediaLifecycleEventSchemas("visual-novel"),
		propertiesSchema: visualNovelPropertiesJsonSchema,
	},
	{
		icon: "folders",
		eventSchemas: [],
		slug: "collection",
		name: "Collection",
		trackerSlug: "media",
		accentColor: "#F59E0B",
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
		icon: "dumbbell",
		slug: "exercise",
		name: "Exercise",
		trackerSlug: "fitness",
		accentColor: "#2DD4BF",
		propertiesSchema: exercisePropertiesJsonSchema,
		eventSchemas: [
			{
				name: "Workout Set",
				slug: "workout-set",
				propertiesSchema: workoutSetPropertiesJsonSchema,
			},
		],
	},
	{
		slug: "workout",
		name: "Workout",
		icon: "dumbbell",
		eventSchemas: [],
		trackerSlug: "fitness",
		accentColor: "#22C55E",
		propertiesSchema: workoutPropertiesJsonSchema,
	},
];

const getBuiltInSavedViewName = (slug: BuiltinMediaEntitySchemaSlug) => {
	return match(slug)
		.with("book", () => "All Books")
		.with("show", () => "All Shows")
		.with("anime", () => "All Anime")
		.with("manga", () => "All Manga")
		.with("music", () => "All Music")
		.with("movie", () => "All Movies")
		.with("podcast", () => "All Podcasts")
		.with("audiobook", () => "All Audiobooks")
		.with("comic-book", () => "All Comic Books")
		.with("video-game", () => "All Video Games")
		.with("visual-novel", () => "All Visual Novels")
		.exhaustive();
};

export const authenticationBuiltinSavedViews = () => [
	{
		slug: "collections",
		name: "Collections",
		entitySchemaSlug: "collection",
		displayConfiguration: createDefaultDisplayConfiguration("collection"),
	},
	{
		slug: "all-persons",
		name: "All Persons",
		trackerSlug: "media",
		entitySchemaSlug: "person",
		relationships: [{ relationshipSchemaSlug: "in-library" as const }],
		displayConfiguration: createDefaultDisplayConfiguration("person"),
	},
	{
		slug: "all-exercises",
		name: "All Exercises",
		trackerSlug: "fitness",
		entitySchemaSlug: "exercise",
		displayConfiguration: createDefaultDisplayConfiguration("exercise"),
	},
	{
		slug: "all-workouts",
		name: "All Workouts",
		trackerSlug: "fitness",
		entitySchemaSlug: "workout",
		displayConfiguration: createDefaultDisplayConfiguration("workout"),
	},
	...builtinMediaEntitySchemaSlugs.map((slug) => ({
		trackerSlug: "media",
		entitySchemaSlug: slug,
		name: getBuiltInSavedViewName(slug),
		slug: normalizeSlug(getBuiltInSavedViewName(slug)),
		relationships: [{ relationshipSchemaSlug: "in-library" as const }],
		displayConfiguration: createDefaultDisplayConfiguration(slug),
	})),
];

export const authenticationBuiltinRelationshipSchemas = () => [
	{
		slug: "in-library",
		name: "In Library",
		sourceEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
		targetEntitySchemaSlug: "library",
	},
	{
		slug: "member-of",
		name: "Member Of",
		sourceEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
		targetEntitySchemaSlug: "collection",
	},
	...builtinMediaEntitySchemaSlugs.map((mediaSlug) => ({
		sourceEntitySchemaSlug: "person",
		targetEntitySchemaSlug: mediaSlug,
		slug: normalizeSlug(`person to ${mediaSlug}`),
		name: `Person to ${mediaSlug.charAt(0).toUpperCase() + mediaSlug.slice(1)}`,
		propertiesSchema: {
			fields: {
				roles: {
					label: "Roles",
					description:
						"Roles this person filled in this production (e.g. Director, Actor, Writer)",
					type: "array" as const,
					items: {
						label: "Role",
						description: "A specific role name (e.g. Director, Actor, Writer)",
						type: "string" as const,
					},
				},
			},
		},
	})),
];
