import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/language";
import { castJson, column, jsonPath, table } from "@ryot-app/ryotql";
import type { SavedViewLayoutProjectionsInput } from "@ryot-app/ryotql-recipes/saved-views";

type ViewExpressions = { readonly table: Omit<SavedViewLayoutProjectionsInput["table"], "entity"> };

const entity = table("entity", "entity");
const entityColumn = (name: string) => column(entity, name);
const entityProperty = (property: string) => jsonPath(column(entity, "properties"), property);
const entityImage = () => castJson(jsonPath(column(entity, "properties"), "images", 0));
const text = (expression: ScalarExpression) => ({ expression, displayKind: "text" as const });
const number = (expression: ScalarExpression) => ({ expression, displayKind: "number" as const });

const tableColumns = (slug: string): ViewExpressions["table"]["columns"] => {
	const name = { label: "Name", ...text(entityColumn("name")) };
	const year = { label: "Year", ...number(entityProperty("publishYear")) };
	if (slug === "person") {
		return [name, { label: "Birth Place", ...text(entityProperty("birthPlace")) }];
	}
	if (slug === "company") {
		return [name, { label: "Founded Year", ...number(entityProperty("foundedYear")) }];
	}
	if (slug.endsWith("-group")) {
		return [name, { label: "Parts", ...number(entityProperty("parts")) }];
	}
	if (slug === "book" || slug === "comic-book") {
		return [name, year, { label: "Pages", ...number(entityProperty("pages")) }];
	}
	if (slug === "show") {
		return [name, year, { label: "Status", ...text(entityProperty("productionStatus")) }];
	}
	if (slug === "movie" || slug === "audiobook") {
		return [name, year, { label: "Runtime", ...number(entityProperty("runtime")) }];
	}
	if (slug === "anime") {
		return [name, year, { label: "Episodes", ...number(entityProperty("episodes")) }];
	}
	if (slug === "manga") {
		return [name, year, { label: "Chapters", ...number(entityProperty("chapters")) }];
	}
	if (slug === "podcast") {
		return [name, year, { label: "Episodes", ...number(entityProperty("totalEpisodes")) }];
	}
	if (slug === "visual-novel") {
		return [name, year, { label: "Length", ...number(entityProperty("lengthMinutes")) }];
	}
	return [name, year];
};

export const buildViewExpressions = (slug: string): ViewExpressions => ({
	table: { image: entityImage(), columns: tableColumns(slug) },
});
