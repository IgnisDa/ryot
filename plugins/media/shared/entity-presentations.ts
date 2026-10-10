import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	average,
	castNumber,
	castText,
	column,
	coalesce,
	concat,
	conditional,
	defineRecipe,
	eq,
	inArray,
	isNotNull,
	jsonArrayFirst,
	jsonElement,
	jsonPath,
	literal,
	selectedField,
	selectedRowsSource,
	table,
	type SelectedIncludes,
	type SelectedRow,
	type SelectedRowsSource,
	type SelectedSelection,
} from "@ryot-app/plugin-kit/ryotql";

import {
	entityIdentitySelection,
	entitySchema,
	propertyJson,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import { MediaImageAssetSchema } from "./media-image";

export type MediaPresentationSource<Data> = SelectedRowsSource<Data>;

export const selectedPresentationSource = <
	const Selection extends SelectedSelection,
	const Includes extends SelectedIncludes = Record<never, never>,
>(input: {
	readonly table: Table;
	readonly selection: Selection;
	readonly include?: Includes | undefined;
}): MediaPresentationSource<SelectedRow<Selection, Includes>> => {
	return selectedRowsSource(input.table, {
		selection: input.selection,
		...(input.include === undefined ? {} : { include: input.include }),
	});
};

export const mediaPresentationSourceRecipe = <Data>(
	source: MediaPresentationSource<Data>,
	input: { readonly entityIds: readonly string[]; readonly entitySchemaSlug: string },
) => {
	const entity = table("entity", "entity");
	return defineRecipe(() => ({
		map: ({ presentation }) => Result.succeed(presentation.items),
		queries: {
			presentation: source.query({
				limit: 100,
				orderBy: [ascending(column(entity, "id"))],
				where: and(
					entitySchema(entity, input.entitySchemaSlug),
					inArray(
						column(entity, "id"),
						input.entityIds.map((entityId) => literal(entityId)),
					),
				),
			}),
		},
	}))();
};

export const preferredMediaImageExpression = (entity: Table, purpose = "cover") => {
	const images = propertyJson(entity, "images");
	const element = jsonElement();
	return coalesce(
		jsonArrayFirst(images, {
			select: element,
			orderBy: [ascending(literal(0))],
			where: eq(castText(jsonPath(element, "purpose")), literal(purpose)),
		}),
		jsonPath(images, 0),
	);
};

export const mediaPresentationImageSelection = (entity: Table) => ({
	image: selectedField(preferredMediaImageExpression(entity), Schema.NullOr(MediaImageAssetSchema)),
});

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

export const mediaPresentationSource = (slug: string) => {
	const media = table("entity", "entity");
	return selectedPresentationSource({
		table: media,
		selection: {
			...entityIdentitySelection(media),
			...mediaPresentationImageSelection(media),
			rating: selectedField(reviewRatingAverage(media), Schema.NullOr(Schema.Finite)),
			primary: selectedField(primaryExpression(media, slug), Schema.NullOr(Schema.String)),
			secondary: selectedField(secondaryExpression(media, slug), Schema.NullOr(Schema.String)),
		},
	});
};

export type MediaPresentationData =
	ReturnType<typeof mediaPresentationSource> extends MediaPresentationSource<infer Data>
		? Data
		: never;
