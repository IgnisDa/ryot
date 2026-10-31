import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/language";
import type {
	EntityBrowserSummary,
	SavedViewTableColumn,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { column, jsonPath, table } from "@ryot-app/ryotql";

import { preferredMediaImageExpression } from "../shared/entity-presentations";

type ViewColumn = SavedViewTableColumn & { readonly expression: ScalarExpression };

type ViewExpressions = {
	readonly summary: EntityBrowserSummary;
	readonly table: { readonly image: ScalarExpression; readonly columns: readonly ViewColumn[] };
};

const entity = table("entity", "entity");
const entityColumn = (name: string) => column(entity, name);
const entityProperty = (property: string) => jsonPath(column(entity, "properties"), property);
const entityImage = () => preferredMediaImageExpression(entity);
const text = (expression: ScalarExpression) => ({ expression, displayKind: "text" as const });
const yearValue = (expression: ScalarExpression) => ({ expression, displayKind: "year" as const });
const number = (expression: ScalarExpression) => ({ expression, displayKind: "number" as const });

const tableColumns = (slug: string): ViewExpressions["table"]["columns"] => {
	const name = { field: "name", label: "Name", ...text(entityColumn("name")) };
	const year = { label: "Year", field: "publishYear", ...yearValue(entityProperty("publishYear")) };
	if (slug === "person") {
		return [
			name,
			{ field: "birthPlace", label: "Birth Place", ...text(entityProperty("birthPlace")) },
		];
	}
	if (slug === "company") {
		return [
			name,
			{ field: "foundedYear", label: "Founded Year", ...yearValue(entityProperty("foundedYear")) },
		];
	}
	if (slug.endsWith("-group")) {
		return [name, { field: "parts", label: "Parts", ...number(entityProperty("parts")) }];
	}
	if (slug === "book" || slug === "comic-book") {
		return [name, year, { field: "pages", label: "Pages", ...number(entityProperty("pages")) }];
	}
	if (slug === "show") {
		return [
			name,
			year,
			{ label: "Status", field: "productionStatus", ...text(entityProperty("productionStatus")) },
		];
	}
	if (slug === "movie" || slug === "audiobook") {
		return [
			name,
			year,
			{ field: "runtime", label: "Runtime", ...number(entityProperty("runtime")) },
		];
	}
	if (slug === "anime") {
		return [
			name,
			year,
			{ field: "episodes", label: "Episodes", ...number(entityProperty("episodes")) },
		];
	}
	if (slug === "manga") {
		return [
			name,
			year,
			{ field: "chapters", label: "Chapters", ...number(entityProperty("chapters")) },
		];
	}
	if (slug === "podcast") {
		return [
			name,
			year,
			{ label: "Episodes", field: "totalEpisodes", ...number(entityProperty("totalEpisodes")) },
		];
	}
	if (slug === "visual-novel") {
		return [
			name,
			year,
			{ label: "Length", field: "lengthMinutes", ...number(entityProperty("lengthMinutes")) },
		];
	}
	return [name, year];
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
		table: { columns, image: entityImage() },
		summary: { image: "image", subtitle: summarySubtitle(columns) },
	};
};
