import type { AppSchema } from "@ryot/ts-utils/app-schema";
import { normalizeSlug } from "@ryot/ts-utils/slug";
import { createEntityColumnExpression } from "@ryot/ts-utils/view-language";
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
import {
	type BuiltinMediaEntitySchemaSlug,
	builtinMediaEntitySchemaSlugs,
} from "~/lib/media/constants";
import { mangaPropertiesJsonSchema } from "~/lib/media/manga";
import { mediaGroupPropertiesJsonSchema } from "~/lib/media/media-group";
import { moviePropertiesJsonSchema } from "~/lib/media/movie";
import { musicPropertiesJsonSchema } from "~/lib/media/music";
import { personPropertiesJsonSchema } from "~/lib/media/person";
import { podcastPropertiesJsonSchema } from "~/lib/media/podcast";
import { showPropertiesJsonSchema } from "~/lib/media/show";
import { videoGamePropertiesJsonSchema } from "~/lib/media/video-game";
import { visualNovelPropertiesJsonSchema } from "~/lib/media/visual-novel";
import {
	createDefaultDisplayConfiguration,
	createDefaultQueryDefinition,
} from "~/modules/saved-views";
import type {
	DisplayConfiguration,
	LatestRelationshipJoinDefinition,
	SavedViewQueryDefinition,
} from "~/modules/saved-views";

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
		icon: "heart-pulse",
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

export const authenticationBuiltinEntitySchemas = () => [
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
		.with("book-group", () => "All Book Series")
		.with("comic-book", () => "All Comic Books")
		.with("video-game", () => "All Video Games")
		.with("movie-group", () => "All Movie Series")
		.with("music-group", () => "All Music Albums")
		.with("visual-novel", () => "All Visual Novels")
		.with("audiobook-group", () => "All Audiobook Series")
		.with("comic-book-group", () => "All Comic Book Series")
		.with("video-game-group", () => "All Video Game Franchises")
		.exhaustive();
};

const inLibraryRelationshipJoin = {
	required: true,
	key: "inLibrary",
	direction: "outgoing" as const,
	kind: "latestRelationship" as const,
	relationshipSchemaSlug: "in-library" as const,
};

type AuthenticationBuiltinSavedView = {
	slug: string;
	name: string;
	icon?: string;
	trackerSlug?: string;
	accentColor?: string;
	entitySchemaSlug?: string;
	queryDefinition?: SavedViewQueryDefinition;
	displayConfiguration: DisplayConfiguration;
	relationshipJoins?: LatestRelationshipJoinDefinition[];
};

export const authenticationBuiltinSavedViews = (): AuthenticationBuiltinSavedView[] => [
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
		relationshipJoins: [inLibraryRelationshipJoin],
		displayConfiguration: createDefaultDisplayConfiguration("person"),
	},
	{
		trackerSlug: "media",
		slug: "all-companies",
		name: "All Companies",
		entitySchemaSlug: "company",
		relationshipJoins: [inLibraryRelationshipJoin],
		displayConfiguration: createDefaultDisplayConfiguration("company"),
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
	{
		trackerSlug: "fitness",
		slug: "all-measurements",
		name: "All Measurements",
		entitySchemaSlug: "measurement",
		displayConfiguration: createDefaultDisplayConfiguration("measurement"),
	},
	{
		trackerSlug: "fitness",
		slug: "all-workout-templates",
		name: "All Workout Templates",
		entitySchemaSlug: "workout-template",
		displayConfiguration: createDefaultDisplayConfiguration("workout-template"),
		queryDefinition: {
			...createDefaultQueryDefinition(["workout-template"]),
			sort: {
				direction: "desc",
				expression: createEntityColumnExpression("workout-template", "createdAt"),
			},
		},
	},
	...builtinMediaEntitySchemaSlugs.map((slug) => ({
		trackerSlug: "media",
		entitySchemaSlug: slug,
		name: getBuiltInSavedViewName(slug),
		relationshipJoins: [inLibraryRelationshipJoin],
		slug: normalizeSlug(getBuiltInSavedViewName(slug)),
		displayConfiguration: createDefaultDisplayConfiguration(slug),
	})),
];

type BuiltinRelationshipSchema = {
	slug: string;
	name: string;
	propertiesSchema: AppSchema;
	sourceEntitySchemaSlug: string | null;
	targetEntitySchemaSlug: string | null;
};

const groupRolesPropertiesSchema = {
	fields: {
		roles: {
			label: "Roles",
			type: "array" as const,
			description: "Roles this group filled in this media",
			items: {
				label: "Role",
				type: "string" as const,
				description: "A specific role name",
			},
		},
	},
};

const buildCreditRelationshipSchemas = (input: {
	sourceSlug: string;
	orderDescription: string;
	rolesDescription: string;
	rolesItemDescription: string;
}) =>
	builtinMediaEntitySchemaSlugs.map((mediaSlug) => ({
		sourceEntitySchemaSlug: input.sourceSlug,
		targetEntitySchemaSlug: mediaSlug,
		slug: normalizeSlug(`${input.sourceSlug} to ${mediaSlug}`),
		name: `${input.sourceSlug.charAt(0).toUpperCase() + input.sourceSlug.slice(1)} to ${mediaSlug.charAt(0).toUpperCase() + mediaSlug.slice(1)}`,
		propertiesSchema: {
			fields: {
				order: {
					label: "Order",
					type: "number" as const,
					description: input.orderDescription,
				},
				roles: {
					label: "Roles",
					type: "array" as const,
					description: input.rolesDescription,
					items: {
						label: "Role",
						type: "string" as const,
						description: input.rolesItemDescription,
					},
				},
			},
		},
	}));

export const authenticationBuiltinRelationshipSchemas = (): BuiltinRelationshipSchema[] => [
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
	{
		propertiesSchema: { fields: {} },
		sourceEntitySchemaSlug: "workout",
		slug: "workout-to-workout-template",
		name: "Workout to Workout Template",
		targetEntitySchemaSlug: "workout-template",
	},
	...buildCreditRelationshipSchemas({
		sourceSlug: "person",
		orderDescription: "Display order of this person in the production credits",
		rolesDescription: "Roles this person filled in this production (e.g. Director, Actor, Writer)",
		rolesItemDescription: "A specific role name (e.g. Director, Actor, Writer)",
	}),
	...buildCreditRelationshipSchemas({
		sourceSlug: "company",
		orderDescription: "Display order of this company in the production credits",
		rolesDescription:
			"Roles this company filled in this production (e.g. Developer, Publisher, Studio)",
		rolesItemDescription: "A specific role name (e.g. Developer, Publisher, Studio)",
	}),
	...(
		[
			{ group: "book-group", media: "book", name: "Book Series to Book" },
			{ group: "music-group", media: "music", name: "Music Album to Music" },
			{ group: "movie-group", media: "movie", name: "Movie Collection to Movie" },
			{ group: "audiobook-group", media: "audiobook", name: "Audiobook Series to Audiobook" },
			{ group: "comic-book-group", media: "comic-book", name: "Comic Book Series to Comic Book" },
			{
				media: "video-game",
				group: "video-game-group",
				name: "Video Game Collection to Video Game",
			},
		] as const
	).map(({ group, media, name }) => ({
		name,
		slug: `${group}-to-${media}`,
		sourceEntitySchemaSlug: group,
		targetEntitySchemaSlug: media,
		propertiesSchema: groupRolesPropertiesSchema,
	})),
];
