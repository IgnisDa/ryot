import type { DisplayConfiguration } from "@ryot/contract/display-configuration";
import type { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import { buildDefaultSavedViewQueryDocument } from "@ryot/query-engine/recipes/app";

import { slugify } from "#lib/shared/slug";

import { buildDisplayConfig } from "./view-helpers";

export type BuiltinSavedView = {
	readonly name: string;
	readonly slug: string;
	readonly icon?: string;
	readonly trackerSlug?: string;
	readonly accentColor?: string;
	readonly entitySchemaSlug?: string;
	readonly requireInLibrary?: boolean;
	readonly queryDocument?: QueryDocument;
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

const mediaViewName: Record<(typeof mediaEntitySchemaSlugs)[number], string> = {
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
		requireInLibrary: true,
		entitySchemaSlug: "person",
		displayConfiguration: buildDisplayConfig("person"),
	},
	{
		trackerSlug: "media",
		name: "All Companies",
		slug: "all-companies",
		requireInLibrary: true,
		entitySchemaSlug: "company",
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
		queryDocument: buildDefaultSavedViewQueryDocument({
			schemas: ["measurement"],
			orderBy: [
				{
					order: "desc",
					expr: {
						type: "ref",
						sourceAlias: "entity",
						field: { type: "property", schema: "measurement", path: ["recordedAt"] },
					},
				},
			],
		}),
	},
	{
		trackerSlug: "fitness",
		slug: "all-workout-templates",
		name: "All Workout Templates",
		entitySchemaSlug: "workout-template",
		displayConfiguration: buildDisplayConfig("workout-template"),
		queryDocument: buildDefaultSavedViewQueryDocument({
			schemas: ["workout-template"],
			orderBy: [
				{
					order: "desc",
					expr: {
						type: "ref",
						sourceAlias: "entity",
						field: { type: "system", name: "createdAt" },
					},
				},
			],
		}),
	},
	...mediaEntitySchemaSlugs.map((slug) => {
		const name = mediaViewName[slug];
		return {
			name,
			trackerSlug: "media",
			requireInLibrary: true,
			entitySchemaSlug: slug,
			slug: slugify(name),
			displayConfiguration: buildDisplayConfig(slug),
		};
	}),
];
