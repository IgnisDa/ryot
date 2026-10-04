import type { FieldSelection } from "@ryot-app/contract/modules/ryotql/language";
import type { AuthoredEntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { EntitySchemaSlug, RelationshipSchemaSlug } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import {
	and,
	castNumber,
	coalesce,
	column,
	conditional,
	countDistinct,
	descending,
	eq,
	field,
	gt,
	inArray,
	jsonPath,
	literal,
	maximum,
	or,
	table,
	relationshipSchemaPredicate,
	schemaOwnerPredicate,
} from "@ryot-app/ryotql";
import { propertyFilterFields } from "@ryot-app/ryotql-recipes/property-filter-fields";
import { Result } from "effect";

import { animeRecipes } from "../shared/anime-recipes";
import { audiobookGroupRecipes } from "../shared/audiobook-group-recipes";
import { audiobookRecipes } from "../shared/audiobook-recipes";
import { bookGroupRecipes } from "../shared/book-group-recipes";
import { bookRecipes } from "../shared/book-recipes";
import { comicBookGroupRecipes } from "../shared/comic-book-group-recipes";
import { comicBookRecipes } from "../shared/comic-book-recipes";
import {
	mediaPresentationSource,
	type MediaPresentationSource,
} from "../shared/entity-presentations";
import { mangaRecipes } from "../shared/manga-recipes";
import {
	builtinMediaEntitySchemaSlugs,
	mediaLibraryMembership,
} from "../shared/media-schema-slugs";
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
	["anime", animeRecipes.presentationSource],
	["audiobook", audiobookRecipes.presentationSource],
	["audiobook-group", audiobookGroupRecipes.presentationSource],
	["book", bookRecipes.presentationSource],
	["book-group", bookGroupRecipes.presentationSource],
	["comic-book", comicBookRecipes.presentationSource],
	["comic-book-group", comicBookGroupRecipes.presentationSource],
	["manga", mangaRecipes.presentationSource],
	["movie", movieRecipes.presentationSource],
	["movie-group", movieGroupRecipes.presentationSource],
	["music", musicRecipes.presentationSource],
	["music-group", musicGroupRecipes.presentationSource],
	["podcast", podcastRecipes.presentationSource],
	["show", showRecipes.presentationSource],
	["video-game", videoGameRecipes.presentationSource],
	["video-game-group", videoGameGroupRecipes.presentationSource],
	["visual-novel", visualNovelRecipes.presentationSource],
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

const mediaFilterProperties = [
	{ label: "Publish year", property: "publishYear" },
	{ label: "Provider rating", property: "providerRating" },
	{ property: "isNsfw", label: "Adult content" },
] as const;

const mediaFilterKey = (property: string) => `${property}Value`;

const mediaValueFilterFields = (schema: { readonly propertiesSchema: AppSchema }) => {
	const declared = mediaFilterProperties.filter(
		({ property }) => property in schema.propertiesSchema.fields,
	);
	const labels = new Map<string, string>(declared.map(({ label, property }) => [property, label]));
	return Result.getOrThrow(
		propertyFilterFields(
			schema.propertiesSchema,
			declared.map(({ property }) => ({ property, field: mediaFilterKey(property) })),
		),
	).map((filterField) =>
		Object.assign(filterField, { label: labels.get(filterField.key) ?? filterField.label }),
	);
};

const mediaGenreRelationshipFilter = (schemaSlug: string) => ({
	key: "genres",
	label: "Genres",
	kind: "relationship" as const,
	direction: "outgoing" as const,
	relationship: {
		owner: { kind: "self" as const },
		slug: RelationshipSchemaSlug.make(`${schemaSlug}-to-genre`),
	},
});

const savedViewOrderBy = (slug: string) => {
	const entity = table("entity", "entity");
	if (slug === "person" || slug === "company") {
		const credit = table("relationship", "savedViewCredit");
		return [
			descending(
				countDistinct(credit, column(credit, "targetEntityId"), {
					where: and(
						schemaOwnerPredicate(credit, "relationshipSchemaPluginId", { kind: "self" }),
						eq(column(credit, "sourceEntityId"), column(entity, "id")),
						inArray(
							column(credit, "relationshipSchemaSlug"),
							builtinMediaEntitySchemaSlugs.map((mediaSlug) => literal(`${slug}-to-${mediaSlug}`)),
						),
					),
				}),
			),
		];
	}
	if (slug.endsWith("-group")) {
		return [descending(castNumber(jsonPath(column(entity, "properties"), "parts")))];
	}
	const activity = table("event", "savedViewActivity");
	const membership = table("relationship", "savedViewMembership");
	const addedAt = maximum(membership, column(membership, "createdAt"), {
		where: and(
			relationshipSchemaPredicate(membership, "in-media-library", { kind: "self" }),
			eq(column(membership, "sourceEntityId"), column(entity, "id")),
		),
	});
	const updatedAt = maximum(activity, column(activity, "updatedAt"), {
		where: and(
			schemaOwnerPredicate(activity, "eventSchemaPluginId", { kind: "self" }),
			or(
				eq(column(activity, "entityId"), column(entity, "id")),
				eq(column(activity, "sessionEntityId"), column(entity, "id")),
			),
		),
	});
	return [descending(conditional(gt(updatedAt, addedAt), updatedAt, coalesce(addedAt, updatedAt)))];
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
		const { table: tableExpressions } = buildViewExpressions(view.entitySchemaSlug);
		const presentation = presentationProjection(view.entitySchemaSlug);
		const valueFilterFields = mediaValueFilterFields(schema);
		const filterFields = [
			...valueFilterFields,
			...(builtinMediaEntitySchemaSlugs.some((slug) => slug === view.entitySchemaSlug)
				? [mediaGenreRelationshipFilter(view.entitySchemaSlug)]
				: []),
		];
		const fields = mergePresentationFields(
			[
				field("entityId", column(entity, "id")),
				field("image", tableExpressions.image),
				...tableExpressions.columns.map((tableColumn) =>
					field(tableColumn.field, tableColumn.expression),
				),
				field("ownerPluginId", column(entity, "entitySchemaPluginId")),
				field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
				...valueFilterFields.map(({ key }) =>
					field(mediaFilterKey(key), jsonPath(column(entity, "properties"), key)),
				),
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
				pageSize: 20,
				sortChoices: [],
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
				...(filterFields.length === 0 ? {} : { filterFields }),
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
