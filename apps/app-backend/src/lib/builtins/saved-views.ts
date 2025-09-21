import type { DisplayConfiguration, SavedViewQueryDefinition } from "~/query-language";

import {
	buildDefaultQueryDefinition,
	buildDisplayConfig,
	inLibraryRelationshipJoin,
	toSlug,
} from "./view-helpers";

export type BuiltinSavedView = {
	readonly name: string;
	readonly slug: string;
	readonly icon?: string;
	readonly trackerSlug?: string;
	readonly accentColor?: string;
	readonly entitySchemaSlug?: string;
	readonly relationshipJoins?: unknown[];
	readonly queryDefinition?: SavedViewQueryDefinition;
	readonly displayConfiguration: DisplayConfiguration;
};

const mediaEntitySchemaSlugs = [
	"show",
	"book",
	"movie",
	"music",
	"manga",
	"anime",
	"podcast",
	"audiobook",
	"video-game",
	"comic-book",
	"book-group",
	"movie-group",
	"music-group",
	"visual-novel",
	"audiobook-group",
	"comic-book-group",
	"video-game-group",
] as const;

type MediaEntitySchemaSlug = (typeof mediaEntitySchemaSlugs)[number];

const mediaViewName: Record<MediaEntitySchemaSlug, string> = {
	book: "All Books",
	show: "All Shows",
	anime: "All Anime",
	manga: "All Manga",
	music: "All Music",
	movie: "All Movies",
	podcast: "All Podcasts",
	audiobook: "All Audiobooks",
	"book-group": "All Book Series",
	"comic-book": "All Comic Books",
	"video-game": "All Video Games",
	"movie-group": "All Movie Series",
	"music-group": "All Music Albums",
	"visual-novel": "All Visual Novels",
	"audiobook-group": "All Audiobook Series",
	"comic-book-group": "All Comic Book Series",
	"video-game-group": "All Video Game Franchises",
};

export const builtinSavedViews = (): BuiltinSavedView[] => [
	{
		name: "Collections",
		slug: "collections",
		entitySchemaSlug: "collection",
		displayConfiguration: buildDisplayConfig("collection"),
	},
	{
		name: "All Persons",
		slug: "all-persons",
		trackerSlug: "media",
		entitySchemaSlug: "person",
		relationshipJoins: [inLibraryRelationshipJoin],
		displayConfiguration: buildDisplayConfig("person"),
	},
	{
		trackerSlug: "media",
		name: "All Companies",
		slug: "all-companies",
		entitySchemaSlug: "company",
		relationshipJoins: [inLibraryRelationshipJoin],
		displayConfiguration: buildDisplayConfig("company"),
	},
	{
		name: "All Exercises",
		slug: "all-exercises",
		trackerSlug: "fitness",
		entitySchemaSlug: "exercise",
		displayConfiguration: buildDisplayConfig("exercise"),
	},
	{
		name: "All Workouts",
		slug: "all-workouts",
		trackerSlug: "fitness",
		entitySchemaSlug: "workout",
		displayConfiguration: buildDisplayConfig("workout"),
	},
	{
		trackerSlug: "fitness",
		slug: "all-measurements",
		name: "All Measurements",
		entitySchemaSlug: "measurement",
		displayConfiguration: buildDisplayConfig("measurement"),
		queryDefinition: {
			...buildDefaultQueryDefinition(["measurement"]),
			sort: {
				direction: "desc",
				expression: {
					type: "reference",
					reference: { path: ["properties", "recordedAt"], slug: "measurement", type: "entity" },
				},
			},
		},
	},
	{
		trackerSlug: "fitness",
		slug: "all-workout-templates",
		name: "All Workout Templates",
		entitySchemaSlug: "workout-template",
		displayConfiguration: buildDisplayConfig("workout-template"),
		queryDefinition: {
			...buildDefaultQueryDefinition(["workout-template"]),
			sort: {
				direction: "desc",
				expression: {
					reference: { path: ["createdAt"], slug: "workout-template", type: "entity" },
					type: "reference",
				},
			},
		},
	},
	...mediaEntitySchemaSlugs.map((slug) => {
		const name = mediaViewName[slug];
		return {
			name,
			slug: toSlug(name),
			trackerSlug: "media",
			entitySchemaSlug: slug,
			relationshipJoins: [inLibraryRelationshipJoin],
			displayConfiguration: buildDisplayConfig(slug),
		};
	}),
];
