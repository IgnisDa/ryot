import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	average,
	castNumber,
	castText,
	column,
	concat,
	conditional,
	defineRecipe,
	eq,
	inArray,
	isNotNull,
	jsonPath,
	literal,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";

import {
	entityIdentitySelection,
	entitySchema,
	propertyJson,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import { MediaImageListSchema } from "./media-image";

const reviewRatingAverage = (media: Table) => {
	const review = table("event", "presentationReview");
	return average(review, castNumber(jsonPath(column(review, "properties"), "rating")), {
		where: and(
			eq(column(review, "entityId"), column(media, "id")),
			eq(column(review, "eventSchemaSlug"), literal("review")),
		),
	});
};

const withUnit = (media: Table, property: string, unit: string) => {
	const value = castText(propertyNumber(media, property));
	return conditional(isNotNull(value), concat(value, literal(unit)), literal(null));
};

const primaryExpression = (media: Table, slug: string) => {
	if (slug === "person") {
		return propertyText(media, "birthPlace");
	}
	if (slug === "company") {
		return castText(propertyNumber(media, "foundedYear"));
	}
	if (slug.endsWith("-group")) {
		return castText(propertyNumber(media, "parts"));
	}
	return castText(propertyNumber(media, "publishYear"));
};

const secondaryExpression = (media: Table, slug: string) => {
	switch (slug) {
		case "person":
			return propertyText(media, "birthDate");
		case "book":
		case "show":
			return propertyText(media, "productionStatus");
		case "comic-book":
			return withUnit(media, "pages", " pages");
		case "movie":
		case "audiobook":
			return withUnit(media, "runtime", " min");
		case "manga":
			return withUnit(media, "chapters", " ch");
		case "anime":
			return withUnit(media, "episodes", " eps");
		case "podcast":
			return withUnit(media, "totalEpisodes", " eps");
		case "visual-novel":
			return withUnit(media, "lengthMinutes", " min");
		default:
			return literal(null);
	}
};

export const mediaPresentationRecipe = defineRecipe(
	(input: { readonly slug: string; readonly entityIds: readonly string[] }) => {
		const media = table("entity", "presentationMedia");
		return {
			queries: {
				media: selectedRows(media, {
					limit: 100,
					orderBy: [ascending(column(media, "id"))],
					where: and(
						entitySchema(media, input.slug),
						inArray(
							column(media, "id"),
							input.entityIds.map((entityId) => literal(entityId)),
						),
					),
					selection: {
						...entityIdentitySelection(media),
						images: selectedField(propertyJson(media, "images"), MediaImageListSchema),
						rating: selectedField(reviewRatingAverage(media), Schema.NullOr(Schema.Number)),
						primary: selectedField(
							primaryExpression(media, input.slug),
							Schema.NullOr(Schema.String),
						),
						secondary: selectedField(
							secondaryExpression(media, input.slug),
							Schema.NullOr(Schema.String),
						),
					},
				}),
			},
			map: ({ media: rows }) => Result.succeed(rows.items),
		};
	},
);

export type MediaPresentationData = Recipe.Success<typeof mediaPresentationRecipe>[number];
