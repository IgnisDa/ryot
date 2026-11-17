import { EntityId } from "@ryot-app/contract/schema/brands";
import {
	ascending,
	column,
	defineRecipe,
	inArray,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

export const entityMessageNamesRecipe = (ids: readonly string[]) => {
	const entity = table("entity", "messageEntity");
	return defineRecipe({
		map: ({ entities }) => Result.succeed(entities.items),
		queries: {
			entities: selectedRows(entity, {
				limit: ids.length,
				orderBy: [ascending(column(entity, "id"))],
				where: inArray(column(entity, "id"), ids.map(literal)),
				selection: {
					id: selectedField(column(entity, "id"), EntityId),
					name: selectedField(column(entity, "name"), Schema.String),
				},
			}),
		},
	});
};
