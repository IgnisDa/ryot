import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/language";
import { castJson, column, jsonPath, table, titleCase } from "@ryot-app/ryotql";
import type { SavedViewLayoutProjectionsInput } from "@ryot-app/ryotql-recipes/saved-views";

type ViewExpressions = { readonly table: Omit<SavedViewLayoutProjectionsInput["table"], "entity"> };

const entity = table("entity", "entity");
const entityColumn = (name: string) => column(entity, name);
const entityProperty = (property: string) => jsonPath(column(entity, "properties"), property);
const entityImage = () => castJson(jsonPath(column(entity, "properties"), "images", 0));
const text = (expression: ScalarExpression) => ({ expression, displayKind: "text" as const });
const date = (expression: ScalarExpression) => ({ expression, displayKind: "date" as const });

const tableColumns = (slug: string): ViewExpressions["table"]["columns"] => {
	const name = { label: "Name", ...text(entityColumn("name")) };
	if (slug === "exercise") {
		return [name, { label: "Level", ...text(titleCase(entityProperty("level"))) }];
	}
	return [
		name,
		{ label: "Created At", ...date(entityColumn("createdAt")) },
		{ label: "Comment", ...text(entityProperty("comment")) },
	];
};

export const buildViewExpressions = (slug: string): ViewExpressions => ({
	table: { columns: tableColumns(slug), image: slug === "exercise" ? entityImage() : null },
});
