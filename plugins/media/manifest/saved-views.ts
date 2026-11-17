import type { ManifestText } from "@ryot-app/contract/modules/plugins/manifest-text";
import type { AuthoredEntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { column, descending, field, table } from "@ryot-app/ryotql";

import {
	mediaBacklogLibraryMembership,
	mediaLibraryMembership,
} from "../shared/media-schema-slugs";
import { catalogMessage } from "../shared/messages.generated";
import { mediaPresentationProjection } from "../shared/presentation-sources";
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

const mediaViews: Record<
	(typeof mediaEntitySchemaSlugs)[number],
	{ readonly slug: string; readonly name: ManifestText }
> = {
	book: { slug: "all-books", name: catalogMessage("saved-view.all-books.name") },
	show: { slug: "all-shows", name: catalogMessage("saved-view.all-shows.name") },
	anime: { slug: "all-anime", name: catalogMessage("saved-view.all-anime.name") },
	manga: { slug: "all-manga", name: catalogMessage("saved-view.all-manga.name") },
	music: { slug: "all-music", name: catalogMessage("saved-view.all-music.name") },
	movie: { slug: "all-movies", name: catalogMessage("saved-view.all-movies.name") },
	podcast: { slug: "all-podcasts", name: catalogMessage("saved-view.all-podcasts.name") },
	audiobook: { slug: "all-audiobooks", name: catalogMessage("saved-view.all-audiobooks.name") },
	"book-group": {
		slug: "all-book-series",
		name: catalogMessage("saved-view.all-book-series.name"),
	},
	"comic-book": {
		slug: "all-comic-books",
		name: catalogMessage("saved-view.all-comic-books.name"),
	},
	"video-game": {
		slug: "all-video-games",
		name: catalogMessage("saved-view.all-video-games.name"),
	},
	"movie-group": {
		slug: "all-movie-series",
		name: catalogMessage("saved-view.all-movie-series.name"),
	},
	"music-group": {
		slug: "all-music-albums",
		name: catalogMessage("saved-view.all-music-albums.name"),
	},
	"visual-novel": {
		slug: "all-visual-novels",
		name: catalogMessage("saved-view.all-visual-novels.name"),
	},
	"audiobook-group": {
		slug: "all-audiobook-series",
		name: catalogMessage("saved-view.all-audiobook-series.name"),
	},
	"comic-book-group": {
		slug: "all-comic-book-series",
		name: catalogMessage("saved-view.all-comic-book-series.name"),
	},
	"video-game-group": {
		slug: "all-video-game-franchises",
		name: catalogMessage("saved-view.all-video-game-franchises.name"),
	},
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
		{
			slug: "all-people",
			entitySchemaSlug: "person",
			name: catalogMessage("saved-view.all-people.name"),
		},
		{
			slug: "all-companies",
			entitySchemaSlug: "company",
			name: catalogMessage("saved-view.all-companies.name"),
		},
		...mediaEntitySchemaSlugs.map((entitySchemaSlug) => ({
			entitySchemaSlug,
			slug: mediaViews[entitySchemaSlug].slug,
			name: mediaViews[entitySchemaSlug].name,
		})),
	] as const;

	return definitions.map((view, sortOrder) => {
		const schema = schemas.get(view.entitySchemaSlug);
		if (!schema) {
			throw new Error(`Missing media entity schema: ${view.entitySchemaSlug}`);
		}
		const { summary, table: tableExpressions } = buildViewExpressions(view.entitySchemaSlug);
		const image = mediaPresentationProjection(view.entitySchemaSlug).fields.find(
			({ key }) => key === "image",
		);
		if (!image) {
			throw new Error(`Missing media image projection: ${view.entitySchemaSlug}`);
		}
		const fields = [
			field("entityId", column(entity, "id")),
			image,
			...tableExpressions.columns.map((tableColumn) =>
				field(tableColumn.field, tableColumn.expression),
			),
			field("ownerPluginId", column(entity, "entitySchemaPluginId")),
			field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
		];
		return {
			sortOrder,
			name: view.name,
			slug: view.slug,
			icon: schema.icon,
			renderer: { kind: "kernel", name: "entity-browser" } as const,
			dataSources: mediaSavedViewDataSources({
				image: image.expr,
				...(summary.subtitle === null
					? {}
					: {
							subtitle: {
								displayKind: summary.subtitle.displayKind,
								expression:
									tableExpressions.columns.find(
										(tableColumn) => tableColumn.field === summary.subtitle?.field,
									)?.expression ?? column(entity, "name"),
							},
						}),
				fields,
				reference: { kind: "self" },
				schema: view.entitySchemaSlug,
				orderBy: savedViewOrderBy(view.entitySchemaSlug),
			}),
			settings: {
				summary,
				pageSize: 20,
				defaultLayout: "grid",
				sourceName: "savedView",
				layouts: ["grid", "list", "table"],
				controls: { sort: true, filter: true, search: "search" },
				subject: {
					entityAlias: "entity",
					schemas: [
						{ owner: { kind: "self" }, slug: EntitySchemaSlug.make(view.entitySchemaSlug) },
					],
				},
				tableColumns: [
					{
						field: "image",
						displayKind: "managed-asset" as const,
						label: catalogMessage("property.image"),
					},
					...tableExpressions.columns.map(({ expression: _, ...tableColumn }) => tableColumn),
				],
				addAction: {
					type: "provider-search",
					schema: { owner: { kind: "self" }, slug: EntitySchemaSlug.make(view.entitySchemaSlug) },
					library: schema.eventSchemas.some(({ slug }) => slug === "backlog")
						? mediaBacklogLibraryMembership
						: mediaLibraryMembership,
				},
			} satisfies AuthoredEntityBrowserSavedViewSettings,
		};
	});
};
