import type { DisplayConfiguration } from "@ryot/contract/display-configuration";
import type { QueryDocument } from "@ryot/contract/modules/query-engine/language";

import { buildDefaultMediaSavedViewQueryDocument } from "./query-recipes";
import { mediaEntitySchemas } from "./schemas/entity-schemas";
import { slugify } from "./shared/slug";
import { buildDisplayConfig } from "./shared/view-helpers";

export type BuiltinSavedView = {
	readonly name: string;
	readonly slug: string;
	readonly icon?: string;
	readonly pluginSlug?: string;
	readonly accentColor?: string;
	readonly entitySchemaSlug?: string;
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
		name: "All Persons",
		slug: "all-persons",
		pluginSlug: "media",
		entitySchemaSlug: "person",
		displayConfiguration: buildDisplayConfig("person"),
	},
	{
		pluginSlug: "media",
		name: "All Companies",
		slug: "all-companies",
		entitySchemaSlug: "company",
		displayConfiguration: buildDisplayConfig("company"),
	},
	...mediaEntitySchemaSlugs.map((slug) => {
		const name = mediaViewName[slug];
		return {
			name,
			pluginSlug: "media",
			entitySchemaSlug: slug,
			slug: slugify(name),
			displayConfiguration: buildDisplayConfig(slug),
		};
	}),
];

export const mediaSavedViews = () => {
	const schemas = new Map(mediaEntitySchemas().map((schema) => [schema.slug, schema]));
	return builtinSavedViews().map((view, sortOrder) => {
		if (!view.entitySchemaSlug) {
			throw new Error(`Media saved view ${view.slug} has no schema`);
		}
		const schema = schemas.get(view.entitySchemaSlug);
		if (!schema) {
			throw new Error(`Missing media entity schema: ${view.entitySchemaSlug}`);
		}
		return {
			sortOrder,
			pluginSlug: "media",
			name: view.name,
			slug: view.slug,
			icon: view.icon ?? schema.icon,
			accentColor: view.accentColor ?? schema.accentColor,
			queryDocument:
				view.queryDocument ??
				buildDefaultMediaSavedViewQueryDocument({
					schemas: [view.entitySchemaSlug],
				}),
			displayConfiguration: view.displayConfiguration,
		};
	});
};
