import { animePropertiesJsonSchema } from "~/lib/media/anime";
import { bookPropertiesJsonSchema } from "~/lib/media/book";
import { builtinMediaEntitySchemaSlugs } from "~/lib/media/constants";
import { mangaPropertiesJsonSchema } from "~/lib/media/manga";
import { createDefaultDisplayConfiguration } from "~/modules/saved-views";

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
	{ name: "Backlog", slug: "backlog", propertiesSchema: { fields: {} } },
	{
		name: "Complete",
		slug: "complete",
		propertiesSchema: {
			fields: {
				startedOn: { type: "datetime" as const },
				completedOn: { type: "datetime" as const },
				completionMode: {
					type: "string" as const,
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
						value: "custom_timestamps",
						operator: "eq" as const,
						path: ["completionMode"],
					},
				},
			],
		},
	},
	{
		name: "Progress",
		slug: "progress",
		propertiesSchema: {
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
		},
	},
	{
		name: "Review",
		slug: "review",
		propertiesSchema: {
			fields: {
				review: { type: "string" as const },
				rating: {
					type: "integer" as const,
					validation: { maximum: 5, minimum: 1, required: true as const },
				},
			},
		},
	},
];

export const authenticationBuiltinEntitySchemas = () => [
	{
		icon: "folders",
		eventSchemas: [],
		slug: "collection",
		name: "Collection",
		trackerSlug: "media",
		accentColor: "#F59E0B",
		propertiesSchema: {
			fields: {
				membershipPropertiesSchema: {
					properties: {},
					type: "object" as const,
					unknownKeys: "strip" as const,
				},
			},
		},
	},
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
		displayConfiguration: createDefaultDisplayConfiguration(slug),
		entitySchemaSlug: slug,
		name:
			slug === "book"
				? "All Books"
				: slug === "anime"
					? "All Anime"
					: "All Manga",
	})),
	{
		name: "Collections",
		entitySchemaSlug: "collection",
		displayConfiguration: createDefaultDisplayConfiguration("collection"),
	},
];
