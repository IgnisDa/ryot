import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/language";
import type {
	EntityBrowserSummary,
	SavedViewTableColumn,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { castJson, column, jsonPath, table, titleCase } from "@ryot-app/ryotql";

type ViewColumn = SavedViewTableColumn & { readonly expression: ScalarExpression };

type ViewExpressions = {
	readonly summary: EntityBrowserSummary;
	readonly table: {
		readonly image: null | ScalarExpression;
		readonly columns: readonly [ViewColumn, ...ViewColumn[]];
	};
};

const entity = table("entity", "entity");
const entityColumn = (name: string) => column(entity, name);
const entityProperty = (property: string) => jsonPath(column(entity, "properties"), property);
const entityImage = () => castJson(jsonPath(column(entity, "properties"), "images", 0));
const text = (expression: ScalarExpression) => ({ expression, displayKind: "text" as const });
const date = (expression: ScalarExpression) => ({ expression, displayKind: "date" as const });

const tableColumns = (slug: string): ViewExpressions["table"]["columns"] => {
	const name = { field: "name", label: "Name", ...text(entityColumn("name")) };
	if (slug === "exercise") {
		return [name, { field: "level", label: "Level", ...text(titleCase(entityProperty("level"))) }];
	}
	return [
		name,
		{ field: "createdAt", label: "Created At", ...date(entityColumn("createdAt")) },
		{ field: "comment", label: "Comment", ...text(entityProperty("comment")) },
	];
};

export const buildViewExpressions = (slug: string): ViewExpressions =>
	slug === "exercise"
		? {
				table: { image: entityImage(), columns: tableColumns(slug) },
				summary: { image: "image", subtitle: { field: "level", displayKind: "text" } },
			}
		: {
				summary: { image: null, subtitle: null },
				table: { image: null, columns: tableColumns(slug) },
			};
