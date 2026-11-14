import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	ascending,
	castText,
	coalesce,
	column,
	concat,
	conditional,
	eq,
	isNotNull,
	jsonArrayFirst,
	jsonElement,
	jsonPath,
	literal,
	selectedField,
	type SelectedRowsSource,
	selectedRowsSource,
	table,
} from "@ryot-app/plugin-kit/ryotql";

import {
	entityIdentitySelection,
	propertyJson,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import { MediaImageAssetSchema } from "./media-image";
import { averageUserRating } from "./user-rating";

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
		case "book":
		case "show":
			return propertyText(media, "productionStatus");
		case "movie":
		case "audiobook":
			return withUnit(media, "runtime", " min");
		case "manga":
			return withUnit(media, "chapters", " ch");
		case "anime":
			return withUnit(media, "episodes", " eps");
		case "person":
			return propertyText(media, "birthDate");
		case "podcast":
			return withUnit(media, "totalEpisodes", " eps");
		case "comic-book":
			return withUnit(media, "pages", " pages");
		case "visual-novel":
			return withUnit(media, "lengthMinutes", " min");
		default:
			return literal(null);
	}
};

const mediaEntitySelection = (media: Table, slug: string) => ({
	...entityIdentitySelection(media),
	...mediaPresentationImageSelection(media),
	primary: selectedField(primaryExpression(media, slug), Schema.NullOr(Schema.String)),
	secondary: selectedField(secondaryExpression(media, slug), Schema.NullOr(Schema.String)),
});
export const mediaEntityPresentationSource = (slug: string) => {
	const media = table("entity", "entity");
	return selectedRowsSource(media, { selection: mediaEntitySelection(media, slug) });
};
export const mediaPresentationSource = (slug: string) => {
	const media = table("entity", "entity");
	return selectedRowsSource(media, {
		selection: {
			...mediaEntitySelection(media, slug),
			rating: selectedField(
				averageUserRating(
					"presentationReview",
					column(media, "id"),
					column(media, "entitySchemaPluginId"),
				),
				Schema.NullOr(Schema.Finite),
			),
		},
	});
};

export type MediaPresentationData =
	ReturnType<typeof mediaPresentationSource> extends SelectedRowsSource<infer Data> ? Data : never;
