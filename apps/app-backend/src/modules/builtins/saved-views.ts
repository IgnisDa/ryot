import { normalizeSlug } from "@ryot/ts-utils/slug";
import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
} from "@ryot/ts-utils/view-language";
import { match } from "ts-pattern";

import {
	builtinMediaEntitySchemaSlugs,
	type BuiltinMediaEntitySchemaSlug,
} from "~/lib/media/constants";
import {
	createDefaultDisplayConfiguration,
	createDefaultQueryDefinition,
} from "~/modules/saved-views";
import type {
	DisplayConfiguration,
	LatestRelationshipJoinDefinition,
	SavedViewQueryDefinition,
} from "~/modules/saved-views";

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

export type BuiltinSavedView = {
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

export const builtinSavedViews = (): BuiltinSavedView[] => [
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
		queryDefinition: {
			...createDefaultQueryDefinition(["measurement"]),
			sort: {
				direction: "desc",
				expression: createEntityPropertyExpression("measurement", "recordedAt"),
			},
		},
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
