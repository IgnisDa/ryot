import type { FieldSelection } from "@ryot-app/contract/modules/ryotql/language";
import type { AuthoredEntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { column, descending, field, table } from "@ryot-app/ryotql";

import { animeRecipes } from "../shared/anime-recipes";
import { audiobookGroupRecipes } from "../shared/audiobook-group-recipes";
import { audiobookRecipes } from "../shared/audiobook-recipes";
import { bookGroupRecipes } from "../shared/book-group-recipes";
import { bookRecipes } from "../shared/book-recipes";
import { comicBookGroupRecipes } from "../shared/comic-book-group-recipes";
import { comicBookRecipes } from "../shared/comic-book-recipes";
import {
	type MediaPresentationSource,
	mediaPresentationSource,
} from "../shared/entity-presentations";
import { mangaRecipes } from "../shared/manga-recipes";
import { mediaLibraryMembership } from "../shared/media-schema-slugs";
import { movieGroupRecipes } from "../shared/movie-group-recipes";
import { movieRecipes } from "../shared/movie-recipes";
import { musicGroupRecipes } from "../shared/music-group-recipes";
import { musicRecipes } from "../shared/music-recipes";
import { podcastRecipes } from "../shared/podcast-recipes";
import { showRecipes } from "../shared/show-recipes";
import { slugify } from "../shared/slug";
import { videoGameGroupRecipes } from "../shared/video-game-group-recipes";
import { videoGameRecipes } from "../shared/video-game-recipes";
import { visualNovelRecipes } from "../shared/visual-novel-recipes";
import { creditCount, groupParts, recentActivity } from "./browse";
import { mediaSavedViewDataSources } from "./query-recipes";
import { mediaEntitySchemas } from "./schemas/entity";
import { buildViewExpressions } from "./view-helpers";

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

type PresentationProjection = Pick<MediaPresentationSource<unknown>, "fields" | "include">;

const schemaPresentationSources = new Map<string, PresentationProjection>([
	["book", bookRecipes.presentationSource],
	["show", showRecipes.presentationSource],
	["anime", animeRecipes.presentationSource],
	["manga", mangaRecipes.presentationSource],
	["movie", movieRecipes.presentationSource],
	["music", musicRecipes.presentationSource],
	["podcast", podcastRecipes.presentationSource],
	["audiobook", audiobookRecipes.presentationSource],
	["book-group", bookGroupRecipes.presentationSource],
	["comic-book", comicBookRecipes.presentationSource],
	["video-game", videoGameRecipes.presentationSource],
	["movie-group", movieGroupRecipes.presentationSource],
	["music-group", musicGroupRecipes.presentationSource],
	["visual-novel", visualNovelRecipes.presentationSource],
	["audiobook-group", audiobookGroupRecipes.presentationSource],
	["comic-book-group", comicBookGroupRecipes.presentationSource],
	["video-game-group", videoGameGroupRecipes.presentationSource],
]);

const presentationProjection = (slug: string): PresentationProjection => {
	if (slug === "person" || slug === "company") {
		return mediaPresentationSource(slug);
	}
	const source = schemaPresentationSources.get(slug);
	if (source === undefined) {
		throw new Error(`Missing media presentation source: ${slug}`);
	}
	return source;
};

const mergePresentationFields = (
	fields: readonly FieldSelection[],
	presentation: PresentationProjection,
) => {
	const keys = new Set(fields.map(({ key }) => key));
	const presentationFields = new Map(
		presentation.fields.map((selection) => [selection.key, selection]),
	);
	return [
		...fields.map((selection) => presentationFields.get(selection.key) ?? selection),
		...presentation.fields.filter(({ key }) => !keys.has(key)),
	];
};

const savedViewOrderBy = (slug: string) => {
	const entity = table("entity", "entity");
	if (slug === "person" || slug === "company") {
		return [descending(creditCount(entity, slug))];
	}
	if (slug.endsWith("-group")) {
		return [descending(groupParts(entity))];
	}
	return [descending(recentActivity(entity))];
};

export const mediaSavedViews = () => {
	const schemas = new Map(mediaEntitySchemas().map((schema) => [schema.slug, schema]));
	const entity = table("entity", "entity");
	const definitions = [
		{ name: "All Persons", slug: "all-persons", entitySchemaSlug: "person" },
		{ name: "All Companies", slug: "all-companies", entitySchemaSlug: "company" },
		...mediaEntitySchemaSlugs.map((entitySchemaSlug) => ({
			entitySchemaSlug,
			name: mediaViewName[entitySchemaSlug],
			slug: slugify(mediaViewName[entitySchemaSlug]),
		})),
	] as const;

	return definitions.map((view, sortOrder) => {
		const schema = schemas.get(view.entitySchemaSlug);
		if (!schema) {
			throw new Error(`Missing media entity schema: ${view.entitySchemaSlug}`);
		}
		const { summary, table: tableExpressions } = buildViewExpressions(view.entitySchemaSlug);
		const presentation = presentationProjection(view.entitySchemaSlug);
		const fields = mergePresentationFields(
			[
				field("entityId", column(entity, "id")),
				field("image", tableExpressions.image),
				...tableExpressions.columns.map((tableColumn) =>
					field(tableColumn.field, tableColumn.expression),
				),
				field("ownerPluginId", column(entity, "entitySchemaPluginId")),
				field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
			],
			presentation,
		);
		return {
			sortOrder,
			name: view.name,
			slug: view.slug,
			icon: schema.icon,
			renderer: { kind: "kernel", name: "entity-browser" } as const,
			dataSources: mediaSavedViewDataSources({
				fields,
				reference: { kind: "self" },
				include: presentation.include,
				schema: view.entitySchemaSlug,
				orderBy: savedViewOrderBy(view.entitySchemaSlug),
			}),
			settings: {
				summary,
				pageSize: 20,
				defaultLayout: "grid",
				searchFields: ["name"],
				sourceName: "savedView",
				layouts: ["grid", "list", "table"],
				subject: {
					entityAlias: "entity",
					schemas: [
						{ owner: { kind: "self" }, slug: EntitySchemaSlug.make(view.entitySchemaSlug) },
					],
				},
				addAction: {
					type: "provider-search",
					library: mediaLibraryMembership,
					schema: { owner: { kind: "self" }, slug: EntitySchemaSlug.make(view.entitySchemaSlug) },
				},
				tableColumns: [
					{ label: "Image", field: "image", displayKind: "managed-asset" as const },
					...tableExpressions.columns.map(({ expression: _, ...tableColumn }) => tableColumn),
				],
			} satisfies AuthoredEntityBrowserSavedViewSettings,
		};
	});
};
