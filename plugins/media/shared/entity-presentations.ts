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
	jsonArrayCount,
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
import { type MediaImage, MediaImageAssetSchema, MediaImageSchema } from "./media-image";
import { averageUserRating } from "./user-rating";

export const mediaArtworkPurpose = (slug: string): MediaImage["purpose"] => {
	if (slug === "person") {
		return "profile";
	}
	return slug === "company" ? "logo" : "cover";
};

export const mediaImageOfPurpose = (entity: Table, purpose: MediaImage["purpose"]) => {
	const element = jsonElement();
	return jsonArrayFirst(propertyJson(entity, "images"), {
		select: element,
		orderBy: [ascending(literal(0))],
		where: eq(castText(jsonPath(element, "purpose")), literal(purpose)),
	});
};

export const mediaLocalizedImageOfPurpose = (entity: Table, purpose: MediaImage["purpose"]) =>
	coalesce(
		conditional(
			eq(propertyText(entity, "localizedArtwork", "purpose"), literal(purpose)),
			propertyJson(entity, "localizedArtwork"),
			literal(null),
		),
		mediaImageOfPurpose(entity, purpose),
	);

export const preferredMediaImageExpression = (
	entity: Table,
	purpose: MediaImage["purpose"] = "cover",
) => coalesce(mediaLocalizedImageOfPurpose(entity, purpose), propertyJson(entity, "images", 0));

export const mediaPresentationImageSelection = (
	entity: Table,
	purpose?: MediaImage["purpose"],
) => ({
	image: selectedField(
		preferredMediaImageExpression(entity, purpose),
		Schema.NullOr(MediaImageAssetSchema),
	),
});

export const mediaDetailArtworkSelection = (entity: Table, purpose: MediaImage["purpose"]) => ({
	imageCount: selectedField(jsonArrayCount(propertyJson(entity, "images")), Schema.Finite),
	firstPreviewImage: selectedField(
		propertyJson(entity, "images", 0),
		Schema.NullOr(MediaImageSchema),
	),
	image: selectedField(
		preferredMediaImageExpression(entity, purpose),
		Schema.NullOr(MediaImageSchema),
	),
	secondPreviewImage: selectedField(
		propertyJson(entity, "images", 1),
		Schema.NullOr(MediaImageSchema),
	),
	backdropPreviewImage: selectedField(
		mediaImageOfPurpose(entity, "backdrop"),
		Schema.NullOr(MediaImageSchema),
	),
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
	...mediaPresentationImageSelection(media, mediaArtworkPurpose(slug)),
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
