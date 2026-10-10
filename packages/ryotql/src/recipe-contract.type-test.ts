import { Result, Schema } from "effect";

import {
	column,
	defineRecipe,
	selectedField,
	selectedRows,
	table,
	type Recipe,
	type SelectedQuery,
} from "./index";

type Assert<Condition extends true> = Condition;
type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;

const entity = table("entity", "entity");
const entries = selectedRows(entity, {
	selection: { id: selectedField(column(entity, "id"), Schema.String) },
});

const unmapped = defineRecipe((id: string, limit: number) => ({
	queries: {
		entries: selectedRows(entity, {
			limit,
			selection: { id: selectedField(column(entity, "id"), Schema.String) },
			where: {
				operator: "eq",
				type: "comparison",
				left: column(entity, "id"),
				right: { value: id, type: "literal" },
			},
		}),
	},
}));
const mapped = defineRecipe((id: string) => ({
	queries: { entries },
	map: ({ entries: selected }) => Result.succeed({ id, count: selected.items.length }),
}));

type UnmappedResult = Assert<
	Equal<
		Recipe.Success<typeof unmapped>["entries"],
		typeof entries extends SelectedQuery<infer Success> ? Success : never
	>
>;
type MappedResult = Assert<Equal<Recipe.Success<typeof mapped>, { id: string; count: number }>>;
type InputTuple = Assert<Equal<Parameters<typeof unmapped>, [id: string, limit: number]>>;
type CannotForgeUnmappedSuccess = Assert<
	{ queries: { entries: typeof entries } } extends ReturnType<
		Parameters<typeof defineRecipe<[], { entries: typeof entries }, string>>[0]
	>
		? false
		: true
>;

export type RecipeContractChecks = [
	UnmappedResult,
	MappedResult,
	InputTuple,
	CannotForgeUnmappedSuccess,
];
