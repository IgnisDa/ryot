import { Result, Schema } from "effect";

import { parameters } from "./authoring";
import {
	column,
	defineRecipe,
	type Recipe,
	selectedField,
	type SelectedQuery,
	selectedRows,
	selectRecipe,
	table,
} from "./index";

type Assert<Condition extends true> = Condition;
type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;

const entity = table("entity", "entity");
const input = parameters({
	fields: {
		id: { label: "ID", type: "string", description: "Entity ID", validation: { required: true } },
		state: {
			type: "enum",
			label: "State",
			description: "State",
			defaultValue: "open",
			choices: { kind: "static", values: [{ value: "open" }, { value: "closed" }] },
		},
	},
});
const entries = selectedRows(entity, {
	selection: { id: selectedField(column(entity, "id"), Schema.String) },
});
const unmapped = defineRecipe({ queries: { entries }, parameters: input.schema });
const mapped = defineRecipe({
	queries: { entries },
	map: ({ entries: selected }) => Result.succeed({ count: selected.items.length }),
});
export type RecipeContractChecks = [
	Assert<Equal<Recipe.Success<typeof mapped>, { count: number }>>,
	Assert<
		Equal<
			Recipe.Success<typeof unmapped>["entries"],
			typeof entries extends SelectedQuery<infer Success> ? Success : never
		>
	>,
	Assert<Equal<Recipe.Arguments<typeof unmapped>["state"], null | "open" | "closed" | undefined>>,
	Assert<Equal<Recipe.Arguments<typeof unmapped>["id"], string>>,
];

const selected = selectRecipe(unmapped, "entries");
export type SelectedRecipeContractChecks = [
	Assert<Equal<typeof selected.query, "entries">>,
	Assert<Equal<keyof Recipe.Queries<typeof unmapped>, "entries">>,
	Assert<Equal<Recipe.Success<typeof selected>, Recipe.Queries<typeof unmapped>["entries"]>>,
	Assert<Equal<Recipe.Arguments<typeof selected>, Recipe.Arguments<typeof unmapped>>>,
	Assert<Equal<Extract<"unknown", keyof Recipe.Queries<typeof unmapped>>, never>>,
];
