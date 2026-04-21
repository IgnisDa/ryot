import {
	createEntityColumnExpression as buildEntityColumnExpression,
	createEntityPropertyExpression as buildEntityPropertyExpression,
} from "@ryot/ts-utils";
import { match } from "ts-pattern";
import type { ViewExpression } from "~/lib/views/expression";
import type {
	DisplayConfiguration,
	GridConfig,
	SavedViewQueryDefinition,
	TableConfig,
} from "./schemas";

export { buildEntityColumnExpression, buildEntityPropertyExpression };

const buildConditionalConcatProperty = (
	schemaSlug: string,
	property: string,
	unit: string,
): ViewExpression => ({
	type: "conditional",
	condition: {
		type: "isNotNull",
		expression: buildEntityPropertyExpression(schemaSlug, property),
	},
	whenTrue: {
		type: "concat",
		values: [
			buildEntityPropertyExpression(schemaSlug, property),
			{ type: "literal", value: unit },
		],
	},
	whenFalse: { type: "literal", value: null },
});

const buildSecondarySubtitleForSlug = (slug: string): ViewExpression | null => {
	return match(slug)
		.with("book", () => buildConditionalConcatProperty(slug, "pages", " pages"))
		.with("show", () => buildEntityPropertyExpression(slug, "productionStatus"))
		.with("movie", () =>
			buildConditionalConcatProperty(slug, "runtime", " min"),
		)
		.with("anime", () =>
			buildConditionalConcatProperty(slug, "episodes", " eps"),
		)
		.with("manga", () =>
			buildConditionalConcatProperty(slug, "chapters", " ch"),
		)
		.with("audiobook", () =>
			buildConditionalConcatProperty(slug, "runtime", " min"),
		)
		.with("podcast", () =>
			buildConditionalConcatProperty(slug, "totalEpisodes", " eps"),
		)
		.with("visual-novel", () =>
			buildConditionalConcatProperty(slug, "lengthMinutes", " min"),
		)
		.with("comic-book", () =>
			buildConditionalConcatProperty(slug, "pages", " pages"),
		)
		.otherwise(() => null);
};

const buildTableColumnsForSlug = (slug: string): TableConfig["columns"] => {
	const nameColumn = {
		label: "Name",
		expression: buildEntityColumnExpression(slug, "name"),
	};
	const yearColumn = {
		label: "Year",
		expression: buildEntityPropertyExpression(slug, "publishYear"),
	};
	return match(slug)
		.with("person", () => [
			nameColumn,
			{
				label: "Birth Place",
				expression: buildEntityPropertyExpression(slug, "birthPlace"),
			},
		])
		.with("collection", () => [nameColumn])
		.with("book", () => [
			nameColumn,
			yearColumn,
			{
				label: "Pages",
				expression: buildEntityPropertyExpression(slug, "pages"),
			},
		])
		.with("show", () => [
			nameColumn,
			yearColumn,
			{
				label: "Status",
				expression: buildEntityPropertyExpression(slug, "productionStatus"),
			},
		])
		.with("movie", () => [
			nameColumn,
			yearColumn,
			{
				label: "Runtime",
				expression: buildEntityPropertyExpression(slug, "runtime"),
			},
		])
		.with("anime", () => [
			nameColumn,
			yearColumn,
			{
				label: "Episodes",
				expression: buildEntityPropertyExpression(slug, "episodes"),
			},
		])
		.with("manga", () => [
			nameColumn,
			yearColumn,
			{
				label: "Chapters",
				expression: buildEntityPropertyExpression(slug, "chapters"),
			},
		])
		.with("audiobook", () => [
			nameColumn,
			yearColumn,
			{
				label: "Runtime",
				expression: buildEntityPropertyExpression(slug, "runtime"),
			},
		])
		.with("podcast", () => [
			nameColumn,
			yearColumn,
			{
				label: "Episodes",
				expression: buildEntityPropertyExpression(slug, "totalEpisodes"),
			},
		])
		.with("comic-book", () => [
			nameColumn,
			yearColumn,
			{
				label: "Pages",
				expression: buildEntityPropertyExpression(slug, "pages"),
			},
		])
		.with("visual-novel", () => [
			nameColumn,
			yearColumn,
			{
				label: "Length",
				expression: buildEntityPropertyExpression(slug, "lengthMinutes"),
			},
		])
		.otherwise(() => [nameColumn, yearColumn]);
};

type EntityCardConfig = Pick<
	GridConfig,
	"calloutProperty" | "primarySubtitleProperty" | "secondarySubtitleProperty"
>;

const createEntityCardConfig = (slug?: string): EntityCardConfig => {
	if (!slug) {
		return {
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
		};
	}
	if (slug === "collection") {
		return {
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
		};
	}
	if (slug === "person") {
		return {
			calloutProperty: null,
			primarySubtitleProperty: buildEntityPropertyExpression(
				slug,
				"birthPlace",
			),
			secondarySubtitleProperty: buildEntityPropertyExpression(
				slug,
				"birthDate",
			),
		};
	}
	return {
		calloutProperty: buildEntityPropertyExpression(slug, "providerRating"),
		primarySubtitleProperty: buildEntityPropertyExpression(slug, "publishYear"),
		secondarySubtitleProperty: buildSecondarySubtitleForSlug(slug),
	};
};

export const createDefaultDisplayConfiguration = (
	entitySchemaSlug?: string,
): DisplayConfiguration => {
	const {
		calloutProperty,
		primarySubtitleProperty,
		secondarySubtitleProperty,
	} = createEntityCardConfig(entitySchemaSlug);
	const cardConfig = {
		calloutProperty,
		primarySubtitleProperty,
		secondarySubtitleProperty,
		titleProperty: entitySchemaSlug
			? buildEntityColumnExpression(entitySchemaSlug, "name")
			: null,
		imageProperty: entitySchemaSlug
			? buildEntityColumnExpression(entitySchemaSlug, "image")
			: null,
	} satisfies GridConfig;
	return {
		grid: cardConfig,
		list: cardConfig,
		table: {
			columns: entitySchemaSlug
				? buildTableColumnsForSlug(entitySchemaSlug)
				: [],
		},
	};
};

export const createDefaultQueryDefinition = (
	entitySchemaSlugs: string[],
): SavedViewQueryDefinition => ({
	filter: null,
	eventJoins: [],
	entitySchemaSlugs,
	sort: {
		direction: "asc",
		expression: entitySchemaSlugs[0]
			? buildEntityColumnExpression(entitySchemaSlugs[0], "name")
			: { type: "literal", value: "" },
	},
});
