import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import type { RowItem, RowsResult, RyotQLResult } from "@ryot-app/contract/modules/ryotql/language";
import { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/ryotql";
import { Effect, Schema } from "effect";

import { requireString } from "~/support/assertions";
import type { HarnessTarget } from "~/support/harness-target";

import type { Client } from "./auth";
import { getApiClient } from "./contract-client";

export type RyotQLPayload = ContractPayload<"ryotql", "execute">;
export type RyotQLResponse = ContractSuccess<"ryotql", "execute">;

export const executeRyotQL = (client: Client, request: RyotQLPayload) =>
	client.call((contract) => contract.ryotql.execute({ payload: request }));

type RequestOptions = Omit<RyotQLPayload, "source" | "arguments">;

const recipeRequest = <Success, const Parameters extends AppSchema>(
	recipe: Recipe<Success, Parameters>,
	arguments_: NoInfer<Recipe.Arguments<Recipe<Success, Parameters>>>,
	options: RequestOptions,
) =>
	Schema.decodeUnknownEffect(ExecutionRequest)({
		...options,
		arguments: Object.fromEntries(
			Object.entries(arguments_).filter(([, value]) => value !== undefined),
		),
		source: {
			kind: "inline",
			document: recipe.document,
			...(recipe.query === undefined ? {} : { query: recipe.query }),
		},
	});

export const executeRyotQLRecipe = <Success, const Parameters extends AppSchema>(
	client: Client,
	recipe: Recipe<Success, Parameters>,
	arguments_: NoInfer<Recipe.Arguments<Recipe<Success, Parameters>>>,
	options: RequestOptions = {},
) =>
	Effect.gen(function* () {
		const request = yield* recipeRequest(recipe, arguments_, options).pipe(Effect.orDie);
		const response = yield* executeRyotQL(client, request);
		return yield* Effect.fromResult(recipe.decode(response)).pipe(Effect.orDie);
	});

export const executeAdminRyotQLRecipe = <Success, const Parameters extends AppSchema>(
	recipe: Recipe<Success, Parameters>,
	arguments_: NoInfer<Recipe.Arguments<Recipe<Success, Parameters>>>,
	target?: HarnessTarget,
	options: RequestOptions = {},
) =>
	Effect.gen(function* () {
		const request = yield* recipeRequest(recipe, arguments_, options).pipe(Effect.orDie);
		const response = yield* getApiClient(target).adminCall((contract) =>
			contract.adminRyotql.execute({ payload: request }),
		);
		return yield* Effect.fromResult(recipe.decode(response)).pipe(Effect.orDie);
	});

type RecipePage<Item> = {
	readonly items: ReadonlyArray<Item>;
	readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: null | string };
};

const collectRecipeItems = <Item, Error, Requirements>(
	execute: (after: string | undefined) => Effect.Effect<RecipePage<Item>, Error, Requirements>,
) =>
	Effect.gen(function* () {
		const items: Item[] = [];
		let after: string | undefined;
		let hasMore: boolean;
		do {
			const page = yield* execute(after);
			items.push(...page.items);
			hasMore = page.pageInfo.hasMore;
			if (hasMore) {
				if (page.pageInfo.nextCursor === null) {
					throw new Error("Paginated RyotQL recipe has more items but no next cursor");
				}
				after = page.pageInfo.nextCursor;
			}
		} while (hasMore);
		return items;
	});

export const collectRyotQLRecipeItems = <Item, const Parameters extends AppSchema>(
	client: Client,
	recipe: Recipe<RecipePage<Item>, Parameters>,
	arguments_: NoInfer<Recipe.Arguments<Recipe<RecipePage<Item>, Parameters>>>,
	query: string,
	limit = 100,
) =>
	collectRecipeItems((after) =>
		executeRyotQLRecipe(client, recipe, arguments_, { pages: { [query]: { after, limit } } }),
	);

export const collectAdminRyotQLRecipeItems = <Item, const Parameters extends AppSchema>(
	recipe: Recipe<RecipePage<Item>, Parameters>,
	arguments_: NoInfer<Recipe.Arguments<Recipe<RecipePage<Item>, Parameters>>>,
	query: string,
	target?: HarnessTarget,
	limit = 100,
) =>
	collectRecipeItems((after) =>
		executeAdminRyotQLRecipe(recipe, arguments_, target, { pages: { [query]: { after, limit } } }),
	);

export const requireRows = (result: undefined | RyotQLResult, key: string): RowsResult => {
	if (result?.type !== "rows") {
		throw new Error(`Expected '${key}' rows`);
	}
	return result;
};

export const requireRyotQLValue = (item: RowItem, key: string): unknown => {
	if (!(key in item)) {
		throw new Error(`Expected field '${key}'`);
	}
	return item[key];
};

export const requireRyotQLText = (item: RowItem, key: string) =>
	requireString(requireRyotQLValue(item, key), `Expected '${key}' to contain text`);

export const requireRyotQLDate = (item: RowItem, key: string) =>
	requireString(requireRyotQLValue(item, key), `Expected '${key}' to contain a date`);

export const executeRyotQLError = (client: Client, request: RyotQLPayload) =>
	Effect.flip(executeRyotQL(client, request));
