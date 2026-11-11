import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castText,
	coalesce,
	column,
	concat,
	conditional,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	inArray,
	isNotNull,
	jsonArrayFirst,
	jsonElement,
	jsonPath,
	literal,
	parameters,
	selectedField,
	type SelectedIncludes,
	type SelectedRow,
	type SelectedRowsSource,
	selectedRowsSource,
	type SelectedSelection,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	entityIdentitySelection,
	propertyJson,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import { MediaImageAssetSchema } from "./media-image";
import { averageUserRating } from "./user-rating";

export type MediaPresentationSource<Data> = SelectedRowsSource<Data>;

export const selectedPresentationSource = <
	const Selection extends SelectedSelection,
	const Includes extends undefined | SelectedIncludes = undefined,
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

const presentationParameters = parameters({
	fields: {
		entityIds: {
			type: "array",
			label: "Titles",
			validation: { required: true },
			description: "Media entities to present",
			items: { type: "string", label: "Entity", description: "Media entity ID" },
		},
	},
});

export const mediaPresentationSourceRecipe = <Data>(
	source: MediaPresentationSource<Data>,
	input: { readonly entitySchemaSlug: string; readonly reference: PluginIdentityReference },
) => {
	const entity = table("entity", "entity");
	return defineRecipe({
		parameters: presentationParameters.schema,
		map: ({ presentation }) => Result.succeed(presentation.items),
		queries: {
			presentation: source.query({
				limit: 100,
				orderBy: [ascending(column(entity, "id"))],
				where: and(
					entitySchemaPredicate(entity, input.entitySchemaSlug, input.reference),
					inArray(column(entity, "id"), presentationParameters.list("entityIds")),
				),
			}),
		},
	});
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

export const mediaPresentationSource = (slug: string) => {
	const media = table("entity", "entity");
	return selectedPresentationSource({
		table: media,
		selection: {
			...entityIdentitySelection(media),
			...mediaPresentationImageSelection(media),
			primary: selectedField(primaryExpression(media, slug), Schema.NullOr(Schema.String)),
			secondary: selectedField(secondaryExpression(media, slug), Schema.NullOr(Schema.String)),
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
	ReturnType<typeof mediaPresentationSource> extends MediaPresentationSource<infer Data>
		? Data
		: never;
