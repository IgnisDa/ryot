import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import type {
	AuthoredSavedViewTableColumn,
	EntityBrowserSummary,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { column, jsonPath, table } from "@ryot-app/ryotql";

import { mediaArtworkPurpose, preferredMediaImageExpression } from "../shared/entity-presentations";
import { catalogMessage } from "../shared/messages.generated";
import { averageUserRating } from "../shared/user-rating";

type ViewColumn = AuthoredSavedViewTableColumn & { readonly expression: ScalarExpression };

type ViewExpressions = {
	readonly summary: EntityBrowserSummary;
	readonly table: { readonly image: ScalarExpression; readonly columns: readonly ViewColumn[] };
};

const entity = table("entity", "entity");
const entityColumn = (name: string) => column(entity, name);
const entityProperty = (property: string) => jsonPath(column(entity, "properties"), property);
const entityImage = (slug: string) =>
	preferredMediaImageExpression(entity, mediaArtworkPurpose(slug));
const text = (expression: ScalarExpression) => ({ expression, displayKind: "text" as const });
const yearValue = (expression: ScalarExpression) => ({ expression, displayKind: "year" as const });
const number = (expression: ScalarExpression) => ({ expression, displayKind: "number" as const });

const entityColumns = (slug: string): ViewExpressions["table"]["columns"] => {
	const name = {
		field: "name",
		label: catalogMessage("property.name"),
		...text(entityColumn("name")),
	};
	const year = {
		field: "publishYear",
		label: catalogMessage("table-column.year"),
		...yearValue(entityProperty("publishYear")),
	};
	if (slug === "person") {
		return [
			name,
			{
				field: "birthPlace",
				label: catalogMessage("property.birth-place"),
				...text(entityProperty("birthPlace")),
			},
		];
	}
	if (slug === "company") {
		return [
			name,
			{
				field: "foundedYear",
				label: catalogMessage("property.founded-year"),
				...yearValue(entityProperty("foundedYear")),
			},
		];
	}
	if (slug.endsWith("-group")) {
		return [
			name,
			{
				field: "parts",
				label: catalogMessage("property.parts"),
				...number(entityProperty("parts")),
			},
		];
	}
	if (slug === "book" || slug === "comic-book") {
		return [
			name,
			year,
			{
				field: "pages",
				label: catalogMessage("property.pages"),
				...number(entityProperty("pages")),
			},
		];
	}
	if (slug === "show") {
		return [
			name,
			year,
			{
				field: "productionStatus",
				label: catalogMessage("table-column.production-status"),
				...text(entityProperty("productionStatus")),
			},
		];
	}
	if (slug === "movie" || slug === "audiobook") {
		return [
			name,
			year,
			{
				field: "runtime",
				label: catalogMessage("property.runtime"),
				...number(entityProperty("runtime")),
			},
		];
	}
	if (slug === "anime") {
		return [
			name,
			year,
			{
				field: "episodes",
				label: catalogMessage("property.episodes"),
				...number(entityProperty("episodes")),
			},
		];
	}
	if (slug === "manga") {
		return [
			name,
			year,
			{
				field: "chapters",
				label: catalogMessage("property.chapters"),
				...number(entityProperty("chapters")),
			},
		];
	}
	if (slug === "podcast") {
		return [
			name,
			year,
			{
				field: "totalEpisodes",
				label: catalogMessage("property.episodes"),
				...number(entityProperty("totalEpisodes")),
			},
		];
	}
	if (slug === "visual-novel") {
		return [
			name,
			year,
			{
				field: "lengthMinutes",
				label: catalogMessage("fact.length"),
				...number(entityProperty("lengthMinutes")),
			},
		];
	}
	return [name, year];
};

const isTitle = (slug: string) =>
	slug !== "person" && slug !== "company" && !slug.endsWith("-group");

const userRating = (): ViewColumn => ({
	field: "userRating",
	displayKind: "rating",
	label: catalogMessage("table-column.user-rating"),
	expression: averageUserRating(
		"tableReview",
		entityColumn("id"),
		entityColumn("entitySchemaPluginId"),
	),
});

const tableColumns = (slug: string): ViewExpressions["table"]["columns"] => {
	const columns = entityColumns(slug);
	return isTitle(slug) ? [...columns, userRating()] : columns;
};

const summarySubtitle = (columns: readonly ViewColumn[]): EntityBrowserSummary["subtitle"] => {
	const detail = columns[1];
	return detail !== undefined && (detail.displayKind === "year" || detail.displayKind === "text")
		? { field: detail.field, displayKind: detail.displayKind }
		: null;
};

export const buildViewExpressions = (slug: string): ViewExpressions => {
	const columns = tableColumns(slug);
	return {
		table: { columns, image: entityImage(slug) },
		summary: { image: "image", subtitle: summarySubtitle(columns) },
	};
};
