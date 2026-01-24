import { match } from "ts-pattern";
import { animePropertiesJsonSchema } from "~/lib/media/anime";
import { bookPropertiesJsonSchema } from "~/lib/media/book";
import {
	type BuiltinMediaEntitySchemaSlug,
	builtinMediaEntitySchemaSlugs,
} from "~/lib/media/constants";
import { mangaPropertiesJsonSchema } from "~/lib/media/manga";
import { personPropertiesJsonSchema } from "~/lib/media/person";
import { createDefaultDisplayConfiguration } from "~/modules/saved-views";

export const builtinPersonRelationshipSlugs = [
	"staff",
	"author",
	"artist",
	"editor",
	"director",
	"publisher",
	"character",
	"illustrator",
	"voice_actor",
] as const;

export type BuiltinPersonRelationshipSlug =
	(typeof builtinPersonRelationshipSlugs)[number];

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
				startedOn: { label: "Started On", type: "datetime" as const },
				completedOn: { label: "Completed On", type: "datetime" as const },
				completionMode: {
					label: "Completion Mode",
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
					label: "Progress Percent",
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
				review: { label: "Review", type: "string" as const },
				rating: {
					label: "Rating",
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
		eventSchemas: mediaLifecycleEventSchemas().filter(
			(schema) => schema.slug === "review",
		),
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
	{
		icon: "folders",
		eventSchemas: [],
		slug: "collection",
		name: "Collection",
		trackerSlug: "media",
		accentColor: "#F59E0B",
		propertiesSchema: {
			fields: {
				description: { label: "Description", type: "string" as const },
				membershipPropertiesSchema: {
					properties: {},
					type: "object" as const,
					unknownKeys: "passthrough" as const,
					label: "Membership Properties Schema",
				},
			},
		},
	},
];

const getBuiltInSavedViewName = (slug: BuiltinMediaEntitySchemaSlug) => {
	return match(slug)
		.with("book", () => "All Books")
		.with("anime", () => "All Anime")
		.with("manga", () => "All Manga")
		.exhaustive();
};

export const authenticationBuiltinSavedViews = () => [
	{
		name: "Collections",
		entitySchemaSlug: "collection",
		displayConfiguration: createDefaultDisplayConfiguration("collection"),
	},
	{
		name: "All Persons",
		trackerSlug: "media",
		entitySchemaSlug: "person",
		displayConfiguration: createDefaultDisplayConfiguration("person"),
	},
	...builtinMediaEntitySchemaSlugs.map((slug) => ({
		trackerSlug: "media",
		entitySchemaSlug: slug,
		name: getBuiltInSavedViewName(slug),
		displayConfiguration: createDefaultDisplayConfiguration(slug),
	})),
];

export const authenticationBuiltinRelationshipSchemas = () => [
	{
		slug: "in_library",
		name: "In Library",
		sourceEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
		targetEntitySchemaSlug: "library",
	},
	{
		slug: "member_of",
		name: "Member Of",
		sourceEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
		targetEntitySchemaSlug: "collection",
	},
	...builtinPersonRelationshipSlugs.map((slug) => ({
		slug,
		targetEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
		sourceEntitySchemaSlug: "person",
		name: slug
			.split("_")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" "),
	})),
];
