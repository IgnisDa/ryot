import { animePropertiesJsonSchema } from "~/lib/zod/media/anime";
import {
	bookPropertiesJsonSchema,
	readEventPropertiesJsonSchema,
} from "~/lib/zod/media/book";
import { mangaPropertiesJsonSchema } from "~/lib/zod/media/manga";
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

const bookEventSchemas = () => [
	{
		name: "Read",
		slug: "read",
		propertiesSchema: readEventPropertiesJsonSchema,
	},
];

export const authenticationBuiltinEntitySchemas = () => [
	{
		slug: "book",
		name: "Book",
		icon: "book-open",
		trackerSlug: "media",
		accentColor: "#5B7FFF",
		eventSchemas: bookEventSchemas(),
		propertiesSchema: bookPropertiesJsonSchema,
	},
	{
		icon: "tv",
		slug: "anime",
		name: "Anime",
		eventSchemas: [],
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
		eventSchemas: [],
		propertiesSchema: mangaPropertiesJsonSchema,
	},
];

export const authenticationBuiltinSavedViews = () => [
	{
		name: "All Books",
		trackerSlug: "media",
		entitySchemaSlug: "book",
		displayConfiguration: defaultDisplayConfiguration,
	},
	{
		name: "All Animes",
		trackerSlug: "media",
		entitySchemaSlug: "anime",
		displayConfiguration: defaultDisplayConfiguration,
	},
	{
		name: "All Mangas",
		trackerSlug: "media",
		entitySchemaSlug: "manga",
		displayConfiguration: defaultDisplayConfiguration,
	},
	{
		icon: "folders",
		name: "Collections",
		accentColor: "#F59E0B",
		displayConfiguration: defaultDisplayConfiguration,
		queryDefinition: createDefaultQueryDefinition([]),
	},
];
