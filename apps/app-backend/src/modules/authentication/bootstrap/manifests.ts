import { animePropertiesJsonSchema } from "~/lib/media/anime";
import { bookPropertiesJsonSchema } from "~/lib/media/book";
import { builtinMediaEntitySchemaSlugs } from "~/lib/media/constants";
import { mangaPropertiesJsonSchema } from "~/lib/media/manga";
import {
	createDefaultQueryDefinition,
	defaultDisplayConfiguration,
} from "~/modules/saved-views/constants";

export const authenticationBuiltinTrackers = () => [
	{
		icon: "film",
		slug: "media",
		name: "Media",
		accentColor: "#5B7FFF",
		description: "Track media across books, anime, and manga.",
	},
	{
		slug: "fitness",
		name: "Fitness",
		icon: "dumbbell",
		accentColor: "#2DD4BF",
		description: "Track workouts, measurements, and progress.",
	},
];

const mediaLifecycleEventSchemas = () => [
	{ name: "Backlog", slug: "backlog", propertiesSchema: {} },
	{
		name: "Progress",
		slug: "progress",
		propertiesSchema: {
			progressPercent: { type: "number" as const, required: true as const },
		},
	},
	{ name: "Complete", slug: "complete", propertiesSchema: {} },
	{ name: "Review", slug: "review", propertiesSchema: {} },
];

export const authenticationBuiltinEntitySchemas = () => [
	{
		slug: "book",
		name: "Book",
		icon: "book-open",
		trackerSlug: "media",
		accentColor: "#5B7FFF",
		eventSchemas: mediaLifecycleEventSchemas(),
		propertiesSchema: bookPropertiesJsonSchema,
	},
	{
		icon: "tv",
		slug: "anime",
		name: "Anime",
		eventSchemas: mediaLifecycleEventSchemas(),
		trackerSlug: "media",
		accentColor: "#FB7185",
		propertiesSchema: animePropertiesJsonSchema,
	},
	{
		slug: "manga",
		name: "Manga",
		icon: "book",
		trackerSlug: "media",
		accentColor: "#A78BFA",
		eventSchemas: mediaLifecycleEventSchemas(),
		propertiesSchema: mangaPropertiesJsonSchema,
	},
];

export const authenticationBuiltinSavedViews = () => [
	...builtinMediaEntitySchemaSlugs.map((slug) => ({
		trackerSlug: "media",
		displayConfiguration: defaultDisplayConfiguration,
		entitySchemaSlug: slug,
		name:
			slug === "book"
				? "All Books"
				: slug === "anime"
					? "All Anime"
					: "All Manga",
	})),
	{
		icon: "folders",
		name: "Collections",
		accentColor: "#F59E0B",
		displayConfiguration: defaultDisplayConfiguration,
		queryDefinition: createDefaultQueryDefinition([]),
	},
];
