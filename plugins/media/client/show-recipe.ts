import { Result, Schema } from "@ryot-app/client-sdk/effect";
import {
	and,
	ascending,
	castJson,
	castNumber,
	castText,
	column,
	defineRecipe,
	eq,
	join,
	jsonPath,
	literal,
	selectedField,
	selectedOptionalRow,
	table,
	type Recipe,
} from "@ryot-app/client-sdk/ryotql";

const MediaImagePurposeSchema = Schema.Literals([
	"cover",
	"backdrop",
	"profile",
	"logo",
	"still",
	"screenshot",
	"artwork",
]);

const mediaImageVariant = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct({ ...fields, purpose: Schema.optional(MediaImagePurposeSchema) });

const MediaImageSchema = Schema.Union([
	mediaImageVariant({ type: Schema.Literal("remote"), url: Schema.String }),
	mediaImageVariant({ type: Schema.Literal("local"), key: Schema.String }),
	mediaImageVariant({ type: Schema.Literal("s3"), key: Schema.String }),
]);

type Table = ReturnType<typeof table>;

const entityId = (entity: Table, id: string) => eq(column(entity, "id"), literal(id));

const entitySchema = (entity: Table, slug: string) =>
	eq(column(entity, "entitySchemaSlug"), literal(slug));

const propertyJson = (entity: Table, property: string) =>
	castJson(jsonPath(column(entity, "properties"), property));

const propertyText = (entity: Table, property: string) =>
	castText(jsonPath(column(entity, "properties"), property));

const propertyNumber = (entity: Table, property: string) =>
	castNumber(jsonPath(column(entity, "properties"), property));

export const showSummaryRecipe = defineRecipe((input: { readonly entityId: string }) => {
	const show = table("entity", "show");
	const requested = table("entity", "requested");
	const provider = table("sandboxProvider", "provider");

	return {
		queries: {
			requested: selectedOptionalRow(requested, {
				orderBy: [ascending(column(requested, "id"))],
				where: entityId(requested, input.entityId),
				selection: {
					entitySchemaSlug: selectedField(column(requested, "entitySchemaSlug"), Schema.String),
				},
			}),
			show: selectedOptionalRow(show, {
				orderBy: [ascending(column(show, "id"))],
				where: and(entitySchema(show, "show"), entityId(show, input.entityId)),
				joins: [join("left", provider, eq(column(show, "providerId"), column(provider, "id")))],
				selection: {
					id: selectedField(column(show, "id"), Schema.String),
					name: selectedField(column(show, "name"), Schema.String),
					genres: selectedField(
						propertyJson(show, "genres"),
						Schema.NullOr(Schema.Array(Schema.String)),
					),
					images: selectedField(
						propertyJson(show, "images"),
						Schema.NullOr(Schema.Array(MediaImageSchema)),
					),
					providerName: selectedField(column(provider, "name"), Schema.NullOr(Schema.String)),
					description: selectedField(
						propertyText(show, "description"),
						Schema.NullOr(Schema.String),
					),
					publishYear: selectedField(
						propertyNumber(show, "publishYear"),
						Schema.NullOr(Schema.Number),
					),
					productionStatus: selectedField(
						propertyText(show, "productionStatus"),
						Schema.NullOr(Schema.String),
					),
					totalSeasons: selectedField(
						propertyNumber(show, "totalSeasons"),
						Schema.NullOr(Schema.Number),
					),
					totalEpisodes: selectedField(
						propertyNumber(show, "totalEpisodes"),
						Schema.NullOr(Schema.Number),
					),
				},
			}),
		},
		map: ({ requested: requestedEntity, show: showEntity }) =>
			Result.succeed({
				show: showEntity ?? null,
				entitySchemaSlug: requestedEntity?.entitySchemaSlug ?? null,
			}),
	};
});

export type ShowRecipeResult = Recipe.Success<typeof showSummaryRecipe>;
export type ShowDetails = NonNullable<ShowRecipeResult["show"]>;
export type MediaImage = NonNullable<ShowDetails["images"]>[number];
