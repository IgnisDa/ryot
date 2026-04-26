import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
	createEventAggregateExpression,
	createTransformExpression,
} from "@ryot/ts-utils";
import { match } from "ts-pattern";
import type { ViewExpression } from "~/lib/views/expression";
import type {
	DisplayConfiguration,
	GridConfig,
	SavedViewQueryDefinition,
	TableConfig,
} from "./schemas";

const buildConditionalConcatProperty = (
	schemaSlug: string,
	property: string,
	unit: string,
): ViewExpression => ({
	type: "conditional",
	condition: {
		type: "isNotNull",
		expression: createEntityPropertyExpression(schemaSlug, property),
	},
	whenTrue: {
		type: "concat",
		values: [
			createEntityPropertyExpression(schemaSlug, property),
			{ type: "literal", value: unit },
		],
	},
	whenFalse: { type: "literal", value: null },
});

const buildSecondarySubtitleForSlug = (slug: string): ViewExpression | null => {
	return match(slug)
		.with("book", () => buildConditionalConcatProperty(slug, "pages", " pages"))
		.with("exercise", () =>
			createTransformExpression(
				"titleCase",
				createEntityPropertyExpression(slug, "equipment"),
			),
		)
		.with("show", () =>
			createEntityPropertyExpression(slug, "productionStatus"),
		)
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
		expression: createEntityColumnExpression(slug, "name"),
	};
	const yearColumn = {
		label: "Year",
		expression: createEntityPropertyExpression(slug, "publishYear"),
	};
	return match(slug)
		.with("person", () => [
			nameColumn,
			{
				label: "Birth Place",
				expression: createEntityPropertyExpression(slug, "birthPlace"),
			},
		])
		.with("exercise", () => [
			nameColumn,
			{
				label: "Level",
				expression: createTransformExpression(
					"titleCase",
					createEntityPropertyExpression(slug, "level"),
				),
			},
			{
				label: "Equipment",
				expression: createTransformExpression(
					"titleCase",
					createEntityPropertyExpression(slug, "equipment"),
				),
			},
		])
		.with("workout", () => [
			nameColumn,
			{
				label: "Started At",
				expression: createEntityPropertyExpression(slug, "startedAt"),
			},
			{
				label: "Ended At",
				expression: createEntityPropertyExpression(slug, "endedAt"),
			},
		])
		.with("collection", () => [nameColumn])
		.with("book", () => [
			nameColumn,
			yearColumn,
			{
				label: "Pages",
				expression: createEntityPropertyExpression(slug, "pages"),
			},
		])
		.with("show", () => [
			nameColumn,
			yearColumn,
			{
				label: "Status",
				expression: createEntityPropertyExpression(slug, "productionStatus"),
			},
		])
		.with("movie", () => [
			nameColumn,
			yearColumn,
			{
				label: "Runtime",
				expression: createEntityPropertyExpression(slug, "runtime"),
			},
		])
		.with("anime", () => [
			nameColumn,
			yearColumn,
			{
				label: "Episodes",
				expression: createEntityPropertyExpression(slug, "episodes"),
			},
		])
		.with("manga", () => [
			nameColumn,
			yearColumn,
			{
				label: "Chapters",
				expression: createEntityPropertyExpression(slug, "chapters"),
			},
		])
		.with("audiobook", () => [
			nameColumn,
			yearColumn,
			{
				label: "Runtime",
				expression: createEntityPropertyExpression(slug, "runtime"),
			},
		])
		.with("podcast", () => [
			nameColumn,
			yearColumn,
			{
				label: "Episodes",
				expression: createEntityPropertyExpression(slug, "totalEpisodes"),
			},
		])
		.with("comic-book", () => [
			nameColumn,
			yearColumn,
			{
				label: "Pages",
				expression: createEntityPropertyExpression(slug, "pages"),
			},
		])
		.with("visual-novel", () => [
			nameColumn,
			yearColumn,
			{
				label: "Length",
				expression: createEntityPropertyExpression(slug, "lengthMinutes"),
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
			primarySubtitleProperty: createEntityPropertyExpression(
				slug,
				"birthPlace",
			),
			secondarySubtitleProperty: createEntityPropertyExpression(
				slug,
				"birthDate",
			),
		};
	}
	if (slug === "exercise") {
		return {
			secondarySubtitleProperty: buildSecondarySubtitleForSlug(slug),
			calloutProperty: createTransformExpression(
				"titleCase",
				createEntityPropertyExpression(slug, "level"),
			),
			primarySubtitleProperty: createTransformExpression(
				"titleCase",
				createEntityPropertyExpression(slug, "kind"),
			),
		};
	}
	if (slug === "workout") {
		return {
			calloutProperty: null,
			primarySubtitleProperty: createEntityPropertyExpression(
				slug,
				"startedAt",
			),
			secondarySubtitleProperty: createEntityPropertyExpression(
				slug,
				"endedAt",
			),
		};
	}
	return {
		secondarySubtitleProperty: buildSecondarySubtitleForSlug(slug),
		calloutProperty: createEventAggregateExpression(
			"review",
			["properties", "rating"],
			"avg",
		),
		primarySubtitleProperty: createEntityPropertyExpression(
			slug,
			"publishYear",
		),
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
			? createEntityColumnExpression(entitySchemaSlug, "name")
			: null,
		imageProperty: entitySchemaSlug
			? createEntityColumnExpression(entitySchemaSlug, "image")
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
	scope: string[],
	options?: { relationships?: SavedViewQueryDefinition["relationships"] },
): SavedViewQueryDefinition => ({
	filter: null,
	eventJoins: [],
	scope,
	computedFields: [],
	relationships: options?.relationships ?? [],
	sort: {
		direction: "asc",
		expression: scope[0]
			? createEntityColumnExpression(scope[0], "name")
			: { type: "literal", value: "" },
	},
});
