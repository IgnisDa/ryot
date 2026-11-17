import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import type {
	AuthoredSavedViewTableColumn,
	EntityBrowserSummary,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { castJson, column, jsonPath, table, titleCase } from "@ryot-app/ryotql";

import { catalogMessage } from "../shared/messages.generated";

type ViewColumn = AuthoredSavedViewTableColumn & { readonly expression: ScalarExpression };

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
	const name = {
		field: "name",
		label: catalogMessage("table-column.name"),
		...text(entityColumn("name")),
	};
	if (slug === "exercise") {
		return [
			name,
			{
				field: "level",
				label: catalogMessage("property.level"),
				...text(titleCase(entityProperty("level"))),
			},
		];
	}
	return [
		name,
		{
			field: "createdAt",
			label: catalogMessage("table-column.created-at"),
			...date(entityColumn("createdAt")),
		},
		{
			field: "comment",
			label: catalogMessage("property.comment"),
			...text(entityProperty("comment")),
		},
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
