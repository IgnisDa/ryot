import {
	createEntityColumnExpression,
	createEntitySchemaExpression,
	createEntityPropertyExpression,
	createEventAggregateExpression,
	createTransformExpression,
} from "@ryot/ts-utils/view-language";
import { match } from "ts-pattern";

import type { ViewExpression } from "~/lib/views/expression";

import type {
	DisplayConfiguration,
	GridConfig,
	SavedViewQueryDefinition,
	TableConfig,
} from "./schemas";

export const buildBuiltinSavedViewName = (entitySchemaName: string) => `All ${entitySchemaName}s`;

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
			createTransformExpression("titleCase", createEntityPropertyExpression(slug, "equipment")),
		)
		.with("show", () => createEntityPropertyExpression(slug, "productionStatus"))
		.with("movie", () => buildConditionalConcatProperty(slug, "runtime", " min"))
		.with("anime", () => buildConditionalConcatProperty(slug, "episodes", " eps"))
		.with("manga", () => buildConditionalConcatProperty(slug, "chapters", " ch"))
		.with("audiobook", () => buildConditionalConcatProperty(slug, "runtime", " min"))
		.with("podcast", () => buildConditionalConcatProperty(slug, "totalEpisodes", " eps"))
		.with("visual-novel", () => buildConditionalConcatProperty(slug, "lengthMinutes", " min"))
		.with("comic-book", () => buildConditionalConcatProperty(slug, "pages", " pages"))
		.otherwise(() => null);
};

const buildTableColumnsForSlug = (slug: string): TableConfig["columns"] => {
	const nameColumn = { label: "Name", expression: createEntityColumnExpression(slug, "name") };
	const yearColumn = {
		label: "Year",
		expression: createEntityPropertyExpression(slug, "publishYear"),
	};
	return match(slug)
		.with("person", () => [
			nameColumn,
			{ label: "Birth Place", expression: createEntityPropertyExpression(slug, "birthPlace") },
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
			{ label: "Started At", expression: createEntityPropertyExpression(slug, "startedAt") },
			{ label: "Ended At", expression: createEntityPropertyExpression(slug, "endedAt") },
		])
		.with("workout-template", () => [
			nameColumn,
			{ label: "Created At", expression: createEntityColumnExpression(slug, "createdAt") },
			{ label: "Comment", expression: createEntityPropertyExpression(slug, "comment") },
		])
		.with("measurement", () => [
			nameColumn,
			{ label: "Comment", expression: createEntityPropertyExpression(slug, "comment") },
			{ label: "Recorded At", expression: createEntityPropertyExpression(slug, "recordedAt") },
		])
		.with("collection", () => [nameColumn])
		.with("book", () => [
			nameColumn,
			yearColumn,
			{ label: "Pages", expression: createEntityPropertyExpression(slug, "pages") },
		])
		.with("show", () => [
			nameColumn,
			yearColumn,
			{ label: "Status", expression: createEntityPropertyExpression(slug, "productionStatus") },
		])
		.with("movie", () => [
			nameColumn,
			yearColumn,
			{ label: "Runtime", expression: createEntityPropertyExpression(slug, "runtime") },
		])
		.with("anime", () => [
			nameColumn,
			yearColumn,
			{ label: "Episodes", expression: createEntityPropertyExpression(slug, "episodes") },
		])
		.with("manga", () => [
			nameColumn,
			yearColumn,
			{ label: "Chapters", expression: createEntityPropertyExpression(slug, "chapters") },
		])
		.with("audiobook", () => [
			nameColumn,
			yearColumn,
			{ label: "Runtime", expression: createEntityPropertyExpression(slug, "runtime") },
		])
		.with("podcast", () => [
			nameColumn,
			yearColumn,
			{ label: "Episodes", expression: createEntityPropertyExpression(slug, "totalEpisodes") },
		])
		.with("comic-book", () => [
			nameColumn,
			yearColumn,
			{ label: "Pages", expression: createEntityPropertyExpression(slug, "pages") },
		])
		.with("visual-novel", () => [
			nameColumn,
			yearColumn,
			{ label: "Length", expression: createEntityPropertyExpression(slug, "lengthMinutes") },
		])
		.otherwise(() => [nameColumn, yearColumn]);
};

type EntityCardConfig = Pick<
	GridConfig,
	"eyebrowProperty" | "calloutProperty" | "primarySubtitleProperty" | "secondarySubtitleProperty"
>;

const createEntityCardConfig = (slug?: string): EntityCardConfig => {
	if (!slug) {
		return {
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
			eyebrowProperty: createEntitySchemaExpression("name"),
		};
	}
	if (slug === "collection") {
		return {
			calloutProperty: null,
			primarySubtitleProperty: null,
			secondarySubtitleProperty: null,
			eyebrowProperty: createEntitySchemaExpression("name"),
		};
	}
	if (slug === "person") {
		return {
			calloutProperty: null,
			eyebrowProperty: createEntitySchemaExpression("name"),
			primarySubtitleProperty: createEntityPropertyExpression(slug, "birthPlace"),
			secondarySubtitleProperty: createEntityPropertyExpression(slug, "birthDate"),
		};
	}
	if (slug === "exercise") {
		return {
			eyebrowProperty: createEntitySchemaExpression("name"),
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
			eyebrowProperty: createEntitySchemaExpression("name"),
			primarySubtitleProperty: createEntityPropertyExpression(slug, "startedAt"),
			secondarySubtitleProperty: createEntityPropertyExpression(slug, "endedAt"),
		};
	}
	if (slug === "workout-template") {
		return {
			calloutProperty: null,
			eyebrowProperty: createEntitySchemaExpression("name"),
			primarySubtitleProperty: createEntityColumnExpression(slug, "createdAt"),
			secondarySubtitleProperty: createEntityPropertyExpression(slug, "comment"),
		};
	}
	if (slug === "measurement") {
		return {
			calloutProperty: null,
			eyebrowProperty: createEntitySchemaExpression("name"),
			primarySubtitleProperty: createEntityPropertyExpression(slug, "recordedAt"),
			secondarySubtitleProperty: createEntityPropertyExpression(slug, "comment"),
		};
	}
	return {
		eyebrowProperty: createEntitySchemaExpression("name"),
		secondarySubtitleProperty: buildSecondarySubtitleForSlug(slug),
		primarySubtitleProperty: createEntityPropertyExpression(slug, "publishYear"),
		calloutProperty: createEventAggregateExpression("review", ["properties", "rating"], "avg"),
	};
};

export const createDefaultDisplayConfiguration = (
	entitySchemaSlug: string,
): DisplayConfiguration => {
	const { eyebrowProperty, calloutProperty, primarySubtitleProperty, secondarySubtitleProperty } =
		createEntityCardConfig(entitySchemaSlug);
	const cardConfig = {
		eyebrowProperty,
		calloutProperty,
		primarySubtitleProperty,
		secondarySubtitleProperty,
		titleProperty: createEntityColumnExpression(entitySchemaSlug, "name"),
		imageProperty: createEntityColumnExpression(entitySchemaSlug, "image"),
	} satisfies GridConfig;
	return {
		grid: cardConfig,
		list: cardConfig,
		table: { columns: buildTableColumnsForSlug(entitySchemaSlug) },
		entityIdProperty: createEntityColumnExpression(entitySchemaSlug, "id"),
	};
};

export const createDefaultQueryDefinition = (
	scope: string[],
	options?: {
		relationshipJoins?: Extract<
			SavedViewQueryDefinition,
			{ mode: "entities" }
		>["relationshipJoins"];
	},
): SavedViewQueryDefinition => ({
	scope,
	filter: null,
	eventJoins: [],
	mode: "entities",
	computedFields: [],
	relationshipJoins: options?.relationshipJoins ?? [],
	sort: {
		direction: "asc",
		expression: scope[0]
			? createEntityColumnExpression(scope[0], "name")
			: { type: "literal", value: "" },
	},
});
