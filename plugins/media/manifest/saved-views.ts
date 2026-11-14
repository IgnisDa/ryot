import type { AuthoredEntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { column, descending, field, table } from "@ryot-app/ryotql";

import {
	mediaBacklogLibraryMembership,
	mediaLibraryMembership,
} from "../shared/media-schema-slugs";
import { mediaPresentationProjection } from "../shared/presentation-sources";
import { slugify } from "../shared/slug";
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
		{ name: "All People", slug: "all-people", entitySchemaSlug: "person" },
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
					{ label: "Image", field: "image", displayKind: "managed-asset" as const },
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
